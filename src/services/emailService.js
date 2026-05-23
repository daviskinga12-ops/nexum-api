// ─────────────────────────────────────────────────
// NEXUM — Email OTP Service (Nodemailer + Gmail)
// src/services/emailService.js
// ─────────────────────────────────────────────────

const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_PASS,
  },
});

/**
 * Send an OTP to an email address.
 * @param {string} email - recipient email
 * @param {string} code  - 6-digit OTP string
 */
async function sendOtpEmail(email, code) {
  const mailOptions = {
    from: `"NEXUM Trust" <${process.env.GMAIL_USER}>`,
    to: email,
    subject: `${code} is your NEXUM verification code`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px; background: #f9f9f9; border-radius: 8px;">
        <h2 style="color: #111; margin-bottom: 8px;">NEXUM Verification</h2>
        <p style="color: #444; font-size: 15px;">Use the code below to verify your account. It expires in <strong>10 minutes</strong>.</p>
        <div style="background: #111; color: #fff; font-size: 36px; font-weight: bold; letter-spacing: 12px; text-align: center; padding: 24px; border-radius: 6px; margin: 24px 0;">
          ${code}
        </div>
        <p style="color: #888; font-size: 13px;">If you didn't request this, you can safely ignore this email.</p>
        <hr style="border: none; border-top: 1px solid #ddd; margin: 24px 0;" />
        <p style="color: #aaa; font-size: 12px;">NEXUM — The infrastructure beneath every exchange.</p>
      </div>
    `,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log(`[NEXUM EMAIL] OTP sent to ${email} — messageId: ${info.messageId}`);
    return { success: true, messageId: info.messageId };
  } catch (err) {
    console.error('[NEXUM EMAIL] Error sending OTP:', err.message);
    throw err;
  }
}

module.exports = { sendOtpEmail };
