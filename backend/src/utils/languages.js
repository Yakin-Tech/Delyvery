// Shared by auth.controller.js (a user's own display language) and
// customer.controller.js (a customer's preferred language for WhatsApp
// messages) so the two lists of supported languages can't drift apart.
const VALID_LANGUAGES = ['en', 'ta', 'ml', 'kn', 'te', 'hi'];

module.exports = { VALID_LANGUAGES };
