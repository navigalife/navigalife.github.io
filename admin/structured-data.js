// Structured data the site publishes as schema.org JSON-LD and share metadata:
//   data/company.json      addressParts (PostalAddress keys), geo (map pin),
//                          founded (foundingDate), languages (also llms.txt)
//   data/site-config.json  seo.knowsAbout, seo.areaServed, seo.imageAlt,
//                          seo.alternateName, seo.googleVerification
//   data/company.json      name, legalName, address, phone, whatsapp (the
//                          Company form's own fields, checked on save)
//   data/site-config.json  seo.title, seo.description (Appearance form)
// Field blocks for the Company and Appearance forms, plus their read-back. Every
// rule is content-rules.js (validateCompanyDetailed, validateCompanyLocationDetailed,
// validateSeoDetailed); errors are placed next to their field and the caller
// blocks the save.
import './content-rules.js';
import { clearError, describeError, focusField } from './a11y.js';

const rules = () => globalThis.MediVascContentRules;

const ADDRESS_FIELDS = [
  { key: 'streetAddress', label: 'Street address', full: true },
  { key: 'addressLocality', label: 'City / locality', placeholder: 'New Delhi' },
  { key: 'addressRegion', label: 'State / region', placeholder: 'Delhi' },
  { key: 'postalCode', label: 'Postal code', placeholder: '110001', inputmode: 'numeric' },
  { key: 'addressCountry', label: 'Country code', placeholder: 'IN', help: 'Two letters, e.g. IN.', maxlength: 2 },
];

const lines = (value) => String(value || '').split('\n').map((item) => item.trim()).filter(Boolean);

// "Company: the structured address needs a city / locality." -> "The structured
// address needs a city / locality." under the field it belongs to.
const fieldMessage = (message) => {
  const text = String(message).replace(/^(Company|SEO):\s*/, '');
  return text.charAt(0).toUpperCase() + text.slice(1);
};

// Clears this block's previous errors, then shows each error under the field its
// path names (or at the top of the block). Each note describes its field
// (aria-describedby); a block-level note describes `blockControl`'s pick, if
// given. Focuses the first field it flags unless `focus` is false. Returns the
// errors. Also used by the list editors (app.js).
export const showErrors = (form, block, errors, fieldFor, { focus = true, blockControl = null } = {}) => {
  const scope = form.querySelector('[data-rule-block="' + block + '"]');
  if (!scope) return errors;
  for (const note of scope.querySelectorAll('.inline-error')) note.remove();
  for (const field of scope.querySelectorAll('[aria-invalid], [aria-describedby^="err-"]')) clearError(field);
  let first = null;
  for (const error of errors) {
    const note = document.createElement('span');
    note.className = 'inline-error';
    note.textContent = fieldMessage(error.message);
    const name = fieldFor(error.path);
    const field = name ? scope.querySelector('[name="' + name + '"]') : null;
    if (field) {
      field.setAttribute('aria-invalid', 'true');
      field.closest('label').append(note);
      describeError(field, note);
      first = first || field;
    } else {
      scope.querySelector('.field-group__heading, h2')?.after(note);
      const control = blockControl && blockControl(scope);
      if (control) describeError(control, note);
    }
  }
  if (first && focus) focusField(first);
  return errors;
};

// Same, for fields that sit outside any rule block (the Company form's names,
// numbers and address; the SEO title and description). Each note carries `tag`,
// so a later run clears only its own. Focuses the first field it flags unless
// `focus` is false. Also used by the list editors (app.js).
export const showFieldErrors = (form, tag, errors, fieldFor, { focus = true } = {}) => {
  for (const note of form.querySelectorAll('.inline-error[data-field-error="' + tag + '"]')) {
    const field = note.closest('label')?.querySelector('[aria-invalid], [aria-describedby]');
    note.remove();
    if (field) clearError(field);
  }
  let first = null;
  for (const error of errors) {
    const name = fieldFor(error.path);
    const field = name ? form.querySelector('[name="' + name + '"]') : null;
    if (!field) continue;
    const note = document.createElement('span');
    note.className = 'inline-error';
    note.dataset.fieldError = tag;
    note.textContent = fieldMessage(error.message);
    field.setAttribute('aria-invalid', 'true');
    field.closest('label').append(note);
    describeError(field, note);
    first = first || field;
  }
  if (first && focus) focusField(first);
  return errors;
};

// ---------------------------------------------------------------- Company

// The Company form's names, address, phone and WhatsApp, read from `company`
// (the record the caller is about to save). A name or address of only spaces
// is blank; a phone or WhatsApp number must be one the site can dial.
const COMPANY_FIELDS = ['name', 'legalName', 'address', 'phone', 'whatsapp'];

export const checkCompanyFields = (form, company) =>
  showFieldErrors(form, 'company', rules().validateCompanyDetailed(company), (path) => (COMPANY_FIELDS.includes(path) ? path : null));

// "Support hours" (company.hours). Under the field: the example, then what the
// build will publish ("Read as: …") or the rule's error. Blank = nothing listed.
const HOURS_HELP = 'Listed for search engines, not shown on the site. Days, then opening and closing times, e.g. “Mon–Sat 10am–7pm; Sun closed”.';

const hoursNote = (value) => {
  const read = rules().parseHours(value);
  if (read.error) return { error: fieldMessage(read.error) };
  return { reading: read.reading ? 'Read as: ' + read.reading + '.' : '' };
};

export const companyHoursField = (company, h) => {
  const note = hoursNote(company.hours);
  return '<label data-rule-block="company-hours">Support hours' +
    '<input name="hours" value="' + h(company.hours || '') + '" placeholder="Mon–Sat 10am–7pm"' + (note.error ? ' aria-invalid="true"' : '') + ' autocomplete="off">' +
    '<span class="field-help">' + h(HOURS_HELP) + '</span>' +
    (note.error ? '<span class="inline-error">' + h(note.error) + '</span>' : '') +
    '<span class="field-help" data-hours-reading' + (note.reading ? '' : ' hidden') + '>' + h(note.reading || '') + '</span></label>';
};

// Refreshes the note under the hours field. While typing (`settled` false) a
// reading appears as soon as the text makes sense, and an error already on
// screen follows the text, but a new error waits for the field to be left (or
// the form saved), so half-typed hours are not flagged. Returns the error.
export const showHoursReading = (input, settled) => {
  const label = input.closest('label');
  const readingNote = label.querySelector('[data-hours-reading]');
  const shown = label.querySelector('.inline-error');
  const note = hoursNote(input.value);
  readingNote.textContent = note.reading || '';
  readingNote.hidden = !note.reading;
  if (note.error && (settled || shown)) {
    const error = shown || document.createElement('span');
    error.className = 'inline-error';
    error.textContent = note.error;
    if (!shown) readingNote.before(error);
    input.setAttribute('aria-invalid', 'true');
    describeError(input, error);
  } else if (!note.error) {
    shown?.remove();
    clearError(input);
  }
  return note.error || null;
};

// "Founded" (company.founded): a four-digit year or blank. "Languages spoken"
// (company.languages): one per line; when the key is absent the box shows the
// default the build publishes (rules().languagesOf), so saving keeps it.
export const companyFoundedField = (company, h) => '<label data-rule-block="company-founded">Founded' +
  '<input name="founded" value="' + h(company.founded || '') + '" inputmode="numeric" maxlength="4" placeholder="2025" autocomplete="off">' +
  '<span class="field-help">The year MediVasc started, e.g. 2025. Listed for search engines. Leave blank to leave it out.</span></label>';

export const companyLanguagesField = (company, h) => '<label data-rule-block="company-languages">Languages spoken' +
  '<textarea name="languages" rows="3">' + h(rules().languagesOf(company).join('\n')) + '</textarea>' +
  '<span class="field-help">One per line. Listed for search engines and AI assistants as the languages you can talk to patients in.</span></label>';

export const companyLocationFields = (company, h) => {
  const parts = company.addressParts || {};
  const geo = company.geo || {};
  const input = (field) => '<label' + (field.full ? ' class="field--full"' : '') + '>' + h(field.label) +
    '<input name="' + field.key + '" value="' + h(parts[field.key] || '') + '"' +
    (field.placeholder ? ' placeholder="' + h(field.placeholder) + '"' : '') +
    (field.inputmode ? ' inputmode="' + field.inputmode + '"' : '') +
    (field.maxlength ? ' maxlength="' + field.maxlength + '" autocapitalize="characters"' : '') +
    ' autocomplete="off">' + (field.help ? '<span class="field-help">' + h(field.help) + '</span>' : '') + '</label>';
  const coordinate = (name, label, value, placeholder) => '<label>' + label +
    '<input name="' + name + '" value="' + h(value === undefined || value === null ? '' : String(value)) + '" inputmode="decimal" placeholder="' + placeholder + '" autocomplete="off"></label>';
  return '<div class="field-group" data-rule-block="company-location" data-testid="company-location"><div class="field-group__heading"><div><h2>Location for search engines</h2><p>The postal address and map pin in the site’s business listing. Leave the address blank to list the plain address above; leave both coordinates blank to omit the pin.</p></div></div>' +
    '<div class="editor-grid">' + ADDRESS_FIELDS.map(input).join('') +
    coordinate('latitude', 'Latitude', geo.latitude, '28.6139') +
    coordinate('longitude', 'Longitude', geo.longitude, '77.2090') +
    '</div></div>';
};

// Writes addressParts + geo from the form into `company` (a fresh object the
// caller only commits when this returns no errors; that includes the hours). All address fields blank ->
// addressParts removed; both coordinates blank -> geo removed. Coordinates are
// stored as numbers.
export const applyCompanyLocation = (form, company) => {
  const data = new FormData(form);
  const value = (key) => String(data.get(key) || '').trim();
  const parts = {};
  for (const { key } of ADDRESS_FIELDS) {
    const text = key === 'addressCountry' ? value(key).toUpperCase() : value(key);
    if (text) parts[key] = text;
  }
  if (Object.keys(parts).length) company.addressParts = parts;
  else delete company.addressParts;
  const latitude = value('latitude');
  const longitude = value('longitude');
  if (latitude || longitude) {
    const number = (text) => (text ? Number(text) : null);
    company.geo = { ...(company.geo || {}), latitude: number(latitude), longitude: number(longitude) };
  } else {
    delete company.geo;
  }
  if (data.has('languages')) company.languages = lines(data.get('languages'));
  // The same rule also checks company.hours and company.founded (read from the
  // form by the caller) and the languages; those errors are shown under their
  // own fields above this block.
  const errors = rules().validateCompanyLocationDetailed(company);
  const head = (error) => error.path.split('.')[0];
  showErrors(form, 'company-founded', errors.filter((error) => head(error) === 'founded'), () => 'founded');
  showErrors(form, 'company-languages', errors.filter((error) => head(error) === 'languages'), () => 'languages');
  showErrors(form, 'company-location', errors.filter((error) => !['hours', 'founded', 'languages'].includes(head(error))), (path) => {
    const [head, key] = path.split('.');
    if (head === 'addressParts') return key || null;
    if (head === 'geo') return key || null;
    return null;
  });
  const hoursInput = form.querySelector('[data-rule-block="company-hours"] [name="hours"]');
  if (hoursInput && showHoursReading(hoursInput, true)) hoursInput.focus();
  return errors;
};

// -------------------------------------------------------------------- SEO

export const seoExtrasFields = (seo, h) => '<div class="field--full seo-extras" data-rule-block="seo-extras"><h2 class="visually-hidden">Search engines and sharing</h2><div class="editor-grid">' +
  '<label class="field--full">Conditions treated<textarea name="seoKnowsAbout" rows="7">' + h((seo.knowsAbout || []).join('\n')) + '</textarea><span class="field-help">One per line. Tells search engines what MediVasc treats.</span></label>' +
  '<label class="field--full">Areas served<textarea name="seoAreaServed" rows="3">' + h((seo.areaServed || []).join('\n')) + '</textarea><span class="field-help">One per line: a city, region, or country.</span></label>' +
  '<label class="field--full">Share-image description<input name="seoImageAlt" value="' + h(seo.imageAlt || '') + '" autocomplete="off"><span class="field-help">Describes the link-preview image for screen readers when the site is shared.</span></label>' +
  '<label>Also known as<input name="seoAlternateName" value="' + h(rules().alternateNameOf(seo)) + '" autocomplete="off"><span class="field-help">Another name search engines should match to MediVasc. “MediVasc India” keeps us apart from unrelated businesses abroad.</span></label>' +
  '<label>Google Search Console code<input name="seoGoogleVerification" value="' + h(seo.googleVerification || '') + '" autocomplete="off" spellcheck="false"><span class="field-help">From Search Console’s “HTML tag” check: paste the code (or the whole tag). Leave blank if the site is already verified another way.</span></label>' +
  '</div></div>';

// Search Console shows a whole tag: <meta name="google-site-verification" content="CODE" />.
// Keep just the code when the owner pastes the tag.
const verificationCode = (value) => {
  const text = String(value || '').trim();
  const tag = text.match(/content\s*=\s*["']([^"']*)["']/i);
  return tag ? tag[1].trim() : text;
};

// Writes knowsAbout / areaServed (one per line, trimmed, blanks dropped),
// imageAlt, alternateName and googleVerification into `seo` when they pass the
// rules; otherwise leaves `seo` untouched and returns the errors. The SEO title
// and description on the same form are checked too (the caller writes those);
// their errors go under their fields.
const SEO_TITLE_FIELDS = { title: 'seoTitle', description: 'seoDescription' };

export const applySeoExtras = (form, seo) => {
  const data = new FormData(form);
  const extras = {
    knowsAbout: lines(data.get('seoKnowsAbout')),
    areaServed: lines(data.get('seoAreaServed')),
    imageAlt: String(data.get('seoImageAlt') || '').trim(),
    alternateName: String(data.get('seoAlternateName') || '').trim(),
    googleVerification: verificationCode(data.get('seoGoogleVerification')),
  };
  const heading = { title: String(data.get('seoTitle') || '').trim(), description: String(data.get('seoDescription') || '').trim() };
  const errors = rules().validateSeoDetailed({ ...seo, ...heading, ...extras });
  const own = (error) => error.path in SEO_TITLE_FIELDS;
  const fields = { knowsAbout: 'seoKnowsAbout', areaServed: 'seoAreaServed', imageAlt: 'seoImageAlt', alternateName: 'seoAlternateName', googleVerification: 'seoGoogleVerification' };
  showErrors(form, 'seo-extras', errors.filter((error) => !own(error)), (path) => fields[path.split('.')[0]] || null);
  showFieldErrors(form, 'seo', errors.filter(own), (path) => SEO_TITLE_FIELDS[path]);
  if (!errors.length) Object.assign(seo, extras);
  return errors;
};
