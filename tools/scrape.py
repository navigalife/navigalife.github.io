#!/usr/bin/env python3
"""Cache-first, single-threaded archival crawler for the source catalogue."""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import random
import re
import subprocess
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from html import unescape
from html.parser import HTMLParser
from pathlib import Path
from typing import Any, Iterable
from urllib.parse import unquote, urljoin, urlparse, urlunparse


ROOT = Path(__file__).resolve().parents[1]
ARCHIVE = ROOT / "scrape"
RAW = ARCHIVE / "raw"
HEADERS = ARCHIVE / "headers"
IMAGES = ARCHIVE / "images"
MANIFEST_PATH = ARCHIVE / "manifest.json"
EXTRACTED_PATH = ARCHIVE / "extracted.json"

# Encoded so the public repository does not retain source-marketplace marks.
PAGE_DOMAIN = base64.b64decode("aW5kaWFtYXJ0LmNvbQ==").decode()
IMAGE_DOMAIN = base64.b64decode("aW1pbWcuY29t").decode()
COMPANY_SLUG = "navigalifeventuresllp-newdelhi"
START_URL = f"https://m.{PAGE_DOMAIN}/{COMPANY_SLUG}/"

PAGE_BUDGET = 30
PAGE_DELAY = (12.0, 20.0)
IMAGE_DELAY = (2.0, 4.0)
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/138.0.0.0 Safari/537.36"
)
CAPTCHA_MARKERS = (
    b"captcha",
    b"verify you are human",
    b"unusual traffic",
    b"access denied",
    b"request blocked",
)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def read_manifest() -> dict[str, Any]:
    if MANIFEST_PATH.exists():
        return json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    return {
        "started_at": now_iso(),
        "seed": START_URL,
        "page_budget": PAGE_BUDGET,
        "urls": {},
        "selected_images": {},
        "blocked_at": None,
        "blocked_host": None,
    }


def write_manifest(manifest: dict[str, Any]) -> None:
    ARCHIVE.mkdir(parents=True, exist_ok=True)
    temp = MANIFEST_PATH.with_suffix(".json.tmp")
    temp.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    os.replace(temp, MANIFEST_PATH)


def archive_name(url: str, suffix: str) -> str:
    digest = hashlib.sha256(url.encode()).hexdigest()[:16]
    stem = Path(urlparse(url).path.rstrip("/")).name or "index"
    stem = re.sub(r"[^a-zA-Z0-9._-]+", "-", stem)[:70]
    return f"{digest}-{stem}{suffix}"


def is_page_host(host: str) -> bool:
    return host == PAGE_DOMAIN or host.endswith(f".{PAGE_DOMAIN}")


def is_image_host(host: str) -> bool:
    return host == IMAGE_DOMAIN or host.endswith(f".{IMAGE_DOMAIN}")


def canonical_url(url: str) -> str:
    parsed = urlparse(url)
    return urlunparse((parsed.scheme or "https", parsed.netloc.lower(), parsed.path, "", parsed.query, ""))


@dataclass
class FetchResult:
    url: str
    status: int
    content_type: str
    local_path: Path
    cached: bool


class PoliteFetcher:
    def __init__(self, manifest: dict[str, Any]) -> None:
        self.manifest = manifest
        self.last_request: dict[str, float] = {}

    def _pace(self, group: str) -> None:
        delay_range = IMAGE_DELAY if group == "image" else PAGE_DELAY
        last = self.last_request.get(group)
        if last is not None:
            wait = random.uniform(*delay_range) - (time.monotonic() - last)
            if wait > 0:
                print(f"Pacing {group} request for {wait:.1f}s", flush=True)
                time.sleep(wait)

    def fetch(self, url: str, referer: str | None, kind: str) -> FetchResult | None:
        url = canonical_url(url)
        cached = self.manifest["urls"].get(url)
        if cached is not None and int(cached.get("status", 0)) >= 100:
            local_path = ROOT / cached["local_path"]
            print(f"CACHE {cached['status']:>3} {url}", flush=True)
            return FetchResult(url, int(cached["status"]), cached.get("content_type", ""), local_path, True)

        host = urlparse(url).hostname or ""
        if is_page_host(host) and self.manifest.get("blocked_at"):
            print(f"BLOCKED-SKIP {url}", flush=True)
            return None

        group = "image" if is_image_host(host) else "page"
        self._pace(group)
        destination_dir = IMAGES if kind == "image" else RAW
        suffix = Path(urlparse(url).path).suffix if kind == "image" else ".html"
        if not suffix or len(suffix) > 6:
            suffix = ".bin" if kind == "image" else ".html"
        destination = destination_dir / archive_name(url, suffix)
        header_path = HEADERS / archive_name(url, ".headers")
        destination.parent.mkdir(parents=True, exist_ok=True)
        header_path.parent.mkdir(parents=True, exist_ok=True)
        temp = destination.with_suffix(destination.suffix + ".part")

        command = [
            "curl",
            "--compressed",
            "--location",
            "--silent",
            "--show-error",
            "--max-time",
            "45",
            "--user-agent",
            USER_AGENT,
            "--header",
            "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
            "--header",
            "Accept-Language: en-US,en;q=0.9",
            "--header",
            "Sec-Fetch-Dest: document",
            "--header",
            "Sec-Fetch-Mode: navigate",
            "--header",
            "Sec-Fetch-Site: same-origin" if referer else "Sec-Fetch-Site: none",
            "--dump-header",
            str(header_path),
            "--output",
            str(temp),
            "--write-out",
            "%{http_code}\n%{url_effective}\n%{content_type}\n",
        ]
        if referer:
            command.extend(["--referer", referer])
        command.append(url)

        started = now_iso()
        self.last_request[group] = time.monotonic()
        try:
            completed = subprocess.run(command, check=False, text=True, capture_output=True)
            lines = completed.stdout.splitlines()
            status = int(lines[0]) if lines and lines[0].isdigit() else 0
            effective_url = lines[1] if len(lines) > 1 else url
            content_type = lines[2] if len(lines) > 2 else ""
        except OSError as error:
            status, effective_url, content_type = 0, url, ""
            completed = subprocess.CompletedProcess(command, 1, "", str(error))

        # Archive every received byte stream before interpreting the response.
        if temp.exists():
            os.replace(temp, destination)
        else:
            destination.write_bytes(b"")

        record = {
            "status": status,
            "requested_at": started,
            "effective_url": effective_url,
            "content_type": content_type,
            "local_path": str(destination.relative_to(ROOT)),
            "headers_path": str(header_path.relative_to(ROOT)),
            "referer": referer,
            "bytes": destination.stat().st_size,
        }
        if completed.returncode:
            record["curl_error"] = completed.stderr.strip()
        self.manifest["urls"][url] = record

        body_prefix = destination.read_bytes()[:500_000].lower()
        captcha = kind == "page" and any(marker in body_prefix for marker in CAPTCHA_MARKERS)
        if is_page_host(host) and (status in (403, 429) or captcha):
            self.manifest["blocked_at"] = now_iso()
            self.manifest["blocked_host"] = host
            record["tripwire"] = "captcha" if captcha and status not in (403, 429) else str(status)
        write_manifest(self.manifest)
        print(f"FETCH {status:>3} {url} ({record['bytes']} bytes)", flush=True)
        return FetchResult(url, status, content_type, destination, False)


class ArchiveParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.links: list[str] = []
        self.images: list[str] = []
        self.json_scripts: list[str] = []
        self.text_parts: list[str] = []
        self._script_type = ""
        self._script_parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = dict(attrs)
        if tag == "a" and values.get("href"):
            self.links.append(values["href"] or "")
        if tag in ("img", "source"):
            for key in ("src", "data-src", "data-original", "srcset", "data-srcset"):
                value = values.get(key)
                if value:
                    self.images.extend(part.strip().split()[0] for part in value.split(",") if part.strip())
        if tag == "script":
            self._script_type = (values.get("type") or "").lower()
            self._script_parts = []

    def handle_endtag(self, tag: str) -> None:
        if tag == "script":
            if "json" in self._script_type and self._script_parts:
                self.json_scripts.append("".join(self._script_parts))
            self._script_type = ""
            self._script_parts = []

    def handle_data(self, data: str) -> None:
        if self._script_type:
            self._script_parts.append(data)
        elif data.strip():
            self.text_parts.append(data.strip())


def parse_html(path: Path) -> ArchiveParser:
    parser = ArchiveParser()
    parser.feed(path.read_text(encoding="utf-8", errors="replace"))
    return parser


def structured_nodes(parser: ArchiveParser) -> Iterable[dict[str, Any]]:
    for script in parser.json_scripts:
        try:
            decoded = json.loads(script)
        except json.JSONDecodeError:
            continue
        yield from flatten_json(decoded)


def gallery_urls(parser: ArchiveParser, page_url: str) -> list[str]:
    urls: list[str] = []
    for node in structured_nodes(parser):
        if str(node.get("@type", "")).lower() != "imagegallery":
            continue
        media = node.get("associatedMedia") or []
        if isinstance(media, dict):
            media = [media]
        for item in media:
            if isinstance(item, dict) and item.get("contentUrl"):
                urls.append(canonical_url(urljoin(page_url, str(item["contentUrl"]))))
    return list(dict.fromkeys(urls))


def category_gallery_urls(html: str, page_url: str) -> list[str]:
    urls = [
        canonical_url(urljoin(page_url, unescape(value)))
        for value in re.findall(r'multi-img-big=["\']([^"\']+)["\']', html, re.I)
    ]
    return list(dict.fromkeys(urls))


def is_relevant_page(url: str) -> bool:
    parsed = urlparse(url)
    host = parsed.hostname or ""
    if not is_page_host(host):
        return False
    path = parsed.path.lower()
    return (
        COMPANY_SLUG in path
        or "/proddetail/" in path
        or "/product/" in path
        or "/products/" in path
        or "/pview" in path
    )


def image_variants(url: str) -> list[str]:
    url = canonical_url(url)
    parsed = urlparse(url)
    if not is_image_host(parsed.hostname or ""):
        return []
    high = re.sub(r"/\d+x\d+/", "/1000x1000/", parsed.path)
    high = re.sub(r"-\d+x\d+(?=\.[^./]+$)", "-1000x1000", high)
    original = re.sub(r"/\d+x\d+/", "/", parsed.path)
    original = re.sub(r"-\d+x\d+(?=\.[^./]+$)", "", original)
    variants = [urlunparse(parsed._replace(path=high)), urlunparse(parsed._replace(path=original))]
    return list(dict.fromkeys(variants))


def crawl(manifest: dict[str, Any]) -> None:
    fetcher = PoliteFetcher(manifest)
    queue: list[tuple[str, str | None]] = [(START_URL, None)]
    queued = {canonical_url(START_URL)}
    page_count = 0
    discovered_images: dict[str, str] = {}

    while queue and page_count < PAGE_BUDGET and not manifest.get("blocked_at"):
        url, referer = queue.pop(0)
        result = fetcher.fetch(url, referer, "page")
        page_count += 1
        if result is None or result.status != 200 or not result.local_path.exists():
            continue
        parser = parse_html(result.local_path)
        html = result.local_path.read_text(encoding="utf-8", errors="replace")
        if "/proddetail/" not in urlparse(result.url).path:
            for href in parser.links:
                linked = canonical_url(urljoin(result.url, unescape(href).strip()))
                if linked not in queued and is_relevant_page(linked):
                    queued.add(linked)
                    queue.append((linked, result.url))
        image_urls = gallery_urls(parser, result.url)
        if "/proddetail/" not in urlparse(result.url).path:
            image_urls.extend(category_gallery_urls(html, result.url))
        for linked in image_urls:
            if is_image_host(urlparse(linked).hostname or ""):
                discovered_images.setdefault(linked, result.url)

    for source_url, referer in discovered_images.items():
        candidates: list[FetchResult] = []
        for candidate in image_variants(source_url):
            result = fetcher.fetch(candidate, referer, "image")
            if result is not None and result.status == 200 and result.local_path.exists():
                candidates.append(result)
        if candidates:
            largest = max(candidates, key=lambda item: item.local_path.stat().st_size)
            manifest["selected_images"][source_url] = str(largest.local_path.relative_to(ROOT))
            write_manifest(manifest)


def flatten_json(value: Any) -> Iterable[dict[str, Any]]:
    if isinstance(value, dict):
        yield value
        for child in value.values():
            yield from flatten_json(child)
    elif isinstance(value, list):
        for child in value:
            yield from flatten_json(child)


def clean_text(value: Any) -> str:
    if not isinstance(value, str):
        return ""
    return re.sub(r"\s+", " ", unescape(re.sub(r"<[^>]+>", " ", value))).strip()


def product_from_page(html: str, page_url: str, parser: ArchiveParser, manifest: dict[str, Any]) -> dict[str, Any] | None:
    name_match = re.search(r'<h1[^>]+id=["\']product-name["\'][^>]*>(.*?)</h1>', html, re.I | re.S)
    if not name_match:
        return None
    name = clean_text(name_match.group(1))
    specifications: dict[str, str] = {}
    table = re.search(r'<div[^>]+class=["\'][^"\']*tabel-Details[^"\']*["\'][^>]*>(.*?)</table>', html, re.I | re.S)
    if table:
        for row in re.findall(r"<tr[^>]*>(.*?)</tr>", table.group(1), re.I | re.S):
            cells = [clean_text(cell) for cell in re.findall(r"<td[^>]*>(.*?)</td>", row, re.I | re.S)]
            if len(cells) >= 2 and cells[0]:
                specifications[cells[0]] = cells[1]
    price_match = re.search(r'<p[^>]+class=["\'][^"\']*priceff[^"\']*["\'][^>]*>(.*?)</p>', html, re.I | re.S)
    images = gallery_urls(parser, page_url)
    description = specifications.pop("Product Description", "")
    product_id_match = re.search(r"-(\d+)\.html$", urlparse(page_url).path)
    return {
        "source_id": product_id_match.group(1) if product_id_match else "",
        "name": name,
        "description": description,
        "specifications": specifications,
        "price": clean_text(price_match.group(1)) if price_match else "",
        "currency": "",
        "image_urls": images,
        "local_image_paths": [manifest["selected_images"][url] for url in images if url in manifest.get("selected_images", {})],
        "source_pages": [page_url],
    }


def products_from_category(html: str, page_url: str, manifest: dict[str, Any]) -> list[dict[str, Any]]:
    category_file = Path(urlparse(page_url).path).name
    if category_file not in {
        "sequential-compression-device.html",
        "compressible-limb-therapy.html",
        "dvt-pump.html",
    }:
        return []
    names: dict[str, str] = {}
    link_pattern = rf'href=["\']{re.escape(category_file)}#(\d+)["\'][^>]*>(.*?)</a>'
    for product_id, raw_name in re.findall(link_pattern, html, re.I | re.S):
        name = clean_text(raw_name)
        if name and name != "...more":
            names.setdefault(product_id, name)

    products: list[dict[str, Any]] = []
    for product_id, name in names.items():
        marker = re.search(rf'\bpDispId=["\']{re.escape(product_id)}["\']', html, re.I)
        if not marker:
            continue
        start = html.rfind("<", 0, marker.start())
        next_marker = re.search(r'\bpDispId=["\']\d+["\']', html[marker.end():], re.I)
        end = marker.end() + next_marker.start() if next_marker else min(len(html), marker.end() + 80_000)
        segment = html[start:end]
        opening_tag = segment[: segment.find(">") + 1]
        specs: dict[str, str] = {}
        spec_match = re.search(r'\bplsqArr=["\']([^"\']*)["\']', opening_tag, re.I)
        if spec_match:
            for pair in unquote(unescape(spec_match.group(1))).split("#"):
                if ":" in pair:
                    key, value = pair.split(":", 1)
                    specs[clean_text(key)] = clean_text(value)
        price_match = re.search(r'\bprice=["\']([^"\']*)["\']', opening_tag, re.I)
        image_urls = [
            canonical_url(urljoin(page_url, unescape(value)))
            for value in re.findall(r'multi-img-big=["\']([^"\']+)["\']', segment, re.I)
        ]
        image_urls = list(dict.fromkeys(image_urls))
        products.append({
            "source_id": product_id,
            "name": name,
            "description": specs.pop("Product Description", ""),
            "specifications": specs,
            "price": clean_text(price_match.group(1)) if price_match else "",
            "currency": "",
            "image_urls": image_urls,
            "local_image_paths": [manifest["selected_images"][url] for url in image_urls if url in manifest.get("selected_images", {})],
            "source_pages": [f"{page_url}#{product_id}"],
        })
    return products


def product_from_json(node: dict[str, Any], page_url: str, manifest: dict[str, Any]) -> dict[str, Any] | None:
    kind = node.get("@type")
    kinds = kind if isinstance(kind, list) else [kind]
    if not any(str(item).lower() in {"product", "individualproduct"} for item in kinds):
        return None
    name = clean_text(node.get("name") or node.get("headline"))
    if not name:
        return None
    raw_images = node.get("image") or []
    if isinstance(raw_images, str):
        raw_images = [raw_images]
    if isinstance(raw_images, dict):
        raw_images = [raw_images.get("url", "")]
    image_urls = [canonical_url(urljoin(page_url, str(item))) for item in raw_images if item]
    offers = node.get("offers") or {}
    if isinstance(offers, list):
        offers = offers[0] if offers else {}
    return {
        "name": name,
        "description": clean_text(node.get("description")),
        "specifications": {},
        "price": clean_text(offers.get("price") if isinstance(offers, dict) else ""),
        "currency": clean_text(offers.get("priceCurrency") if isinstance(offers, dict) else ""),
        "image_urls": image_urls,
        "local_image_paths": [manifest["selected_images"][url] for url in image_urls if url in manifest["selected_images"]],
        "source_pages": [page_url],
    }


def fallback_products(text: str, page_url: str) -> list[dict[str, Any]]:
    products: list[dict[str, Any]] = []
    patterns = (
        r'"(?:productName|product_name|name)"\s*:\s*"([^"\\]{3,120})"',
        r'"title"\s*:\s*"([^"\\]{3,120})"',
    )
    for pattern in patterns:
        for match in re.finditer(pattern, text, flags=re.IGNORECASE):
            name = clean_text(match.group(1))
            if name and not any(word in name.lower() for word in ("navigation", "contact us", "about us")):
                products.append({
                    "name": name,
                    "description": "",
                    "specifications": {},
                    "price": "",
                    "currency": "",
                    "image_urls": [],
                    "local_image_paths": [],
                    "source_pages": [page_url],
                })
    return products


def extract(manifest: dict[str, Any]) -> dict[str, Any]:
    products_by_name: dict[str, dict[str, Any]] = {}
    company: dict[str, Any] = {
        "about": "",
        "address": "",
        "contact": "",
        "gst": "",
        "years": "",
        "certifications": [],
        "facts": {},
    }
    reviews: list[dict[str, Any]] = []
    categories: set[str] = set()
    page_text: dict[str, str] = {}

    for url, record in manifest.get("urls", {}).items():
        if record.get("status") != 200 or not str(record.get("content_type", "")).startswith("text/html"):
            continue
        path = ROOT / record["local_path"]
        if not path.exists():
            continue
        html = path.read_text(encoding="utf-8", errors="replace")
        parser = parse_html(path)
        visible = clean_text(" ".join(parser.text_parts))
        page_text[url] = visible
        candidates: list[dict[str, Any]] = []
        if "/proddetail/" in urlparse(url).path:
            page_product = product_from_page(html, url, parser, manifest)
            if page_product:
                candidates.append(page_product)
        else:
            candidates.extend(products_from_category(html, url, manifest))
        for script in parser.json_scripts:
            try:
                decoded = json.loads(script)
            except json.JSONDecodeError:
                continue
            for node in flatten_json(decoded):
                candidate = product_from_json(node, url, manifest)
                if candidate:
                    candidates.append(candidate)
                kind = str(node.get("@type", "")).lower()
                if kind in {"organization", "localbusiness", "store"}:
                    company["about"] = company["about"] or clean_text(node.get("description"))
                    address = node.get("address")
                    if isinstance(address, dict):
                        parts = [str(value) for key, value in address.items() if key != "@type"]
                        company["address"] = company["address"] or clean_text(" ".join(parts))
        for candidate in candidates:
            key = candidate.get("source_id") or re.sub(r"[^a-z0-9]+", "", candidate["name"].lower())
            if len(key) < 3:
                continue
            existing = products_by_name.get(key)
            if existing is None:
                products_by_name[key] = candidate
            else:
                for field in ("description", "price", "currency"):
                    if not existing[field] and candidate[field]:
                        existing[field] = candidate[field]
                existing["source_pages"] = sorted(set(existing["source_pages"] + candidate["source_pages"]))
                existing["image_urls"] = sorted(set(existing["image_urls"] + candidate["image_urls"]))
                existing["local_image_paths"] = sorted(set(existing["local_image_paths"] + candidate["local_image_paths"]))
                existing["specifications"].update(candidate["specifications"])

        for label in re.findall(r'"(?:categoryName|category_name)"\s*:\s*"([^"\\]+)"', html, re.I):
            categories.add(clean_text(label))
        category_name = {
            "sequential-compression-device.html": "Sequential Compression Devices",
            "compressible-limb-therapy.html": "Compressible Limb Therapy",
            "dvt-pump.html": "DVT Pumps",
        }.get(Path(urlparse(url).path).name)
        if category_name:
            categories.add(category_name)
        gst = re.search(r"\bGST(?:IN)?\s*(?:No\.?|Number|:)\s*([0-9A-Z]{15})\b", visible, re.I)
        if gst and not company["gst"]:
            company["gst"] = gst.group(1)
        if Path(urlparse(url).path).name == "profile.html":
            for raw_key, raw_value in re.findall(
                r"<tr><td>(.*?)</td><td>(.*?)(?=<tr>|</tbody>)",
                html,
                re.I | re.S,
            ):
                key, value = clean_text(raw_key), clean_text(raw_value)
                if key and value:
                    company["facts"][key] = value
            company["gst"] = company["gst"] or company["facts"].get("GST No.", "")
            registration = company["facts"].get("GST Registration Date", "")
            if registration:
                company["years"] = f"GST registered {registration}"
            contact = re.search(r'\bpnsNumber=["\'](\d+)["\']', html, re.I)
            if contact:
                company["contact"] = contact.group(1)
            business_address = re.search(r'Business_Address&quot;:&quot;([^&]+)', html, re.I)
            if business_address:
                company["address"] = clean_text(business_address.group(1).rstrip(", "))

    # Attach every cached source image referenced by a product page when structured data omitted it.
    for product in products_by_name.values():
        if product["local_image_paths"]:
            continue
        page_images: list[str] = []
        for page in product["source_pages"]:
            page_record = manifest["urls"].get(page, {})
            page_path = ROOT / page_record.get("local_path", "")
            if page_path.is_file():
                parser = parse_html(page_path)
                for raw in parser.images:
                    source = canonical_url(urljoin(page, raw))
                    selected = manifest.get("selected_images", {}).get(source)
                    if selected:
                        page_images.append(selected)
        product["local_image_paths"] = sorted(set(page_images))

    result = {
        "extracted_at": now_iso(),
        "products": sorted(products_by_name.values(), key=lambda item: item["name"].lower()),
        "company": company,
        "reviews": reviews,
        "categories": sorted(item for item in categories if item),
        "page_text": page_text,
        "gaps": [],
    }
    if len(result["products"]) < 9:
        result["gaps"].append(f"Only {len(result['products'])} products could be extracted from the available cache.")
    if manifest.get("blocked_at"):
        result["gaps"].append(f"Page crawling stopped by the host tripwire at {manifest['blocked_at']}.")
    EXTRACTED_PATH.write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return result


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--parse-only", action="store_true", help="Extract from cache without network access")
    args = parser.parse_args()
    ARCHIVE.mkdir(parents=True, exist_ok=True)
    manifest = read_manifest()
    write_manifest(manifest)
    if not args.parse_only:
        crawl(manifest)
    result = extract(manifest)
    manifest["completed_at"] = now_iso()
    write_manifest(manifest)
    print(f"Extracted {len(result['products'])} products")
    if result["gaps"]:
        for gap in result["gaps"]:
            print(f"GAP: {gap}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
