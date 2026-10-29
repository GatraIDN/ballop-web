// Vercel serverless entry: every /api/* request goes through the shared BALLOP API.
const { handle } = require('../lib/api');

module.exports = (req, res) => handle(req, res);
