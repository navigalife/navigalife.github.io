// STUB (W3 replaces). See src/blog/CONTRACT.md. All functions are pure.
// JSON-LD builders return plain objects (W1 serialises them into the shell).
const postJsonLd = (ctx, post) => [];          // BlogPosting(+about MedicalCondition) + BreadcrumbList (+ FAQPage)
const landingJsonLd = (ctx) => [];             // Blog + BreadcrumbList
const categoryJsonLd = (ctx, category) => [];  // CollectionPage + BreadcrumbList
const authorJsonLd = (ctx, author) => [];      // ProfilePage + Person
const rssFeed = (ctx) => '';                   // full RSS 2.0 xml for /blog/feed.xml
const sitemapEntries = (ctx) => [];            // ['<url>…</url>', …] incl. <image:image>
const llmsSection = (ctx) => '';               // markdown "## Journal" section for llms.txt
const redirectStub = ({ fromDepth, to, siteUrl }) => ''; // meta-refresh + canonical html
const metaFor = (ctx, page) => ({ title: '', description: '' }); // page: {kind, post|category|author}
module.exports = { postJsonLd, landingJsonLd, categoryJsonLd, authorJsonLd, rssFeed, sitemapEntries, llmsSection, redirectStub, metaFor };
