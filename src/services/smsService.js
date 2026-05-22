// ─────────────────────────────────────────────────
// NEXUM — SMS Service (Africa's Talking)
// src/services/smsService.js
// ─────────────────────────────────────────────────

const AfricasTalking = require('africastalking');

const at = AfricasTalking({
  apiKey:   process.env.AT_API_KEY,
  username: process.env.AT_USERNAME,   // your real AT username (NOT 'sandbox')
});

const sms = at.SMS;

/**
 * Send an OTP to a Kenyan phone number.
 * @param {string} phone  - e.g. '0743717368' or '+254743717368'
 * @param {string} code   - 6-digit OTP string
 */
async function sendOtp(phone, code) {
  // Normalise to +254 format
  const normalised = phone.startsWith('0')
    ? '+254' + phone.slice(1)
    : phone.startsWith('254')
    ? '+' + phone
    : phone;

  const message = `Your NEXUM verification code is: ${code}\n\nValid for 10 minutes. Do not share this code.`;

  try {
    const result = await sms.send({
      to:      [normalised],
      message: message,
      from:    process.env.AT_SENDER_ID || undefined,  // optional shortcode/sender ID
    });

    const recipient = result.SMSMessageData.Recipients[0];

    if (recipient.status !== 'Success') {
      console.error('[NEXUM SMS] Delivery failed:', recipient);
      throw new Error(`SMS delivery failed: ${recipient.status}`);
    }

    console.log(`[NEXUM SMS] Sent to ${normalised} — messageId: ${recipient.messageId}`);
    return { success: true, messageId: recipient.messageId };

  } catch (err) {
    console.error('[NEXUM SMS] Error sending OTP:', err.message);
    throw err;
  }
}

module.exports = { sendOtp };
