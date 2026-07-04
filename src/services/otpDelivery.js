const { sendOtp } = require('./smsService');
const { sendOtpEmail } = require('./emailService');

function smsConfigured() {
  return Boolean(process.env.AT_API_KEY && process.env.AT_USERNAME);
}

function emailConfigured() {
  return Boolean(process.env.GMAIL_USER && process.env.GMAIL_PASS);
}

/**
 * Deliver OTP — SMS first (proves phone ownership), email fallback for bootstrapping.
 * @returns {{ channel: 'sms' | 'email', message: string }}
 */
async function deliverOtp({ phone, email, otp }) {
  if (smsConfigured()) {
    try {
      await sendOtp(phone, otp);
      return { channel: 'sms', message: 'OTP sent to your phone. Verify to continue.' };
    } catch (err) {
      console.error('[NEXUM OTP] SMS failed:', err.message);
      if (!email || !emailConfigured()) throw err;
      console.warn('[NEXUM OTP] Falling back to email delivery');
    }
  }

  if (email && emailConfigured()) {
    await sendOtpEmail(email, otp);
    return { channel: 'email', message: 'OTP sent to your email. Verify to continue.' };
  }

  if (!smsConfigured() && !emailConfigured()) {
    throw new Error(
      'OTP delivery not configured. Set AT_API_KEY + AT_USERNAME (SMS) or GMAIL_USER + GMAIL_PASS (email fallback) on Render.'
    );
  }

  throw new Error('Unable to deliver OTP. Check Africa\'s Talking credentials or add Gmail for email fallback.');
}

module.exports = { deliverOtp, smsConfigured, emailConfigured };
