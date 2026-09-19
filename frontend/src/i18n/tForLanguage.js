import i18next from './index';

// A translator bound to a SPECIFIC language, independent of the admin's own
// active UI language — for messages sent to someone else (a customer's
// WhatsApp reminder) rather than shown on screen. Every locale bundle is
// already loaded eagerly in i18n/index.js's `resources`, so this needs no
// extra fetch; it just asks i18next for a fixed-language instance of the
// same translator `t()` already uses everywhere else.
export function getTranslatorFor(languageCode) {
  return i18next.getFixedT(languageCode || 'en');
}

// customer.preferred_language is null unless explicitly set (see the
// schema.sql comment on customers.preferred_language) — falls back to the
// organization's own default_language, then to English.
export function resolveCustomerLanguage(customer, organization) {
  return customer?.preferred_language || organization?.default_language || 'en';
}
