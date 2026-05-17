const router = require('express').Router();
const supabase = require('../lib/supabase');
const { stkPush, queryStkStatus } = require('../lib/mpesa');
const { requireAuth } = require('../middleware/auth');
const { logTrustEvent } = require('../lib/trustEngine');

// ─── POST /mpesa/stk-push ─────────────────────────
// Initiate payment — subscription or one-time
router.post('/stk-push', requireAuth, async (req, res) => {
  try {
    const { amount, purpose } = req.body;
    // purpose: 'subscription' | 'verification' | 'logistics'

    if (!amount || amount < 1) {
      return res.status(400).json({ error: 'Valid amount is required' });
    }

    // Get user's phone
    const { data: user } = await supabase
      .from('users').select('phone, full_name').eq('id', req.userId).single();

    if (!user) return res.status(404).json({ error: 'User not found' });

    const result = await stkPush({
      phone: user.phone,
      amount,
      accountRef: `NEXUM-${purpose?.toUpperCase() || 'PAY'}`,
      description: `NEXUM ${purpose || 'Payment'} — ${user.full_name}`,
    });

    if (result.ResponseCode !== '0') {
      return res.status(400).json({
        error: 'STK push failed',
        details: result.ResponseDescription,
      });
    }

    // Store pending transaction
    const { data: tx } = await supabase
      .from('transactions')
      .insert({
        sender_id: req.userId,
        amount_kes: amount,
        payment_method: 'mpesa',
        mpesa_ref: result.CheckoutRequestID,
        status: 'pending',
        description: purpose || 'payment',
      })
      .select()
      .single();

    res.json({
      message: 'Payment prompt sent to your phone. Complete the M-Pesa request.',
      checkout_request_id: result.CheckoutRequestID,
      transaction_id: tx.id,
      amount_kes: amount,
      expires_in: 60,
    });
  } catch (err) {
    console.error('[MPESA STK ERROR]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /mpesa/callback ─────────────────────────
// Safaricom calls this URL when payment completes/fails.
// This is the most critical endpoint — it drives trust score updates.
router.post('/callback', async (req, res) => {
  try {
    const { Body } = req.body;
    const callback = Body?.stkCallback;

    if (!callback) {
      return res.status(400).json({ error: 'Invalid callback payload' });
    }

    const { MerchantRequestID, CheckoutRequestID, ResultCode, ResultDesc } = callback;

    // Find transaction by checkout request ID
    const { data: tx } = await supabase
      .from('transactions')
      .select('*, sender:sender_id(id, nexum_id)')
      .eq('mpesa_ref', CheckoutRequestID)
      .single();

    if (!tx) {
      // Acknowledge Safaricom even if we can't find the transaction
      return res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
    }

    if (ResultCode === 0) {
      // Payment successful
      const items = callback.CallbackMetadata?.Item || [];
      const getMeta = (name) => items.find(i => i.Name === name)?.Value;

      const mpesaReceiptNumber = getMeta('MpesaReceiptNumber');
      const transactionDate    = getMeta('TransactionDate');
      const phoneUsed          = getMeta('PhoneNumber');

      await supabase.from('transactions').update({
        status: 'completed',
        mpesa_ref: mpesaReceiptNumber || CheckoutRequestID,
        completed_at: new Date().toISOString(),
      }).eq('id', tx.id);

      // Log trust event — transaction completed → boosts score
      if (tx.sender_id) {
        await logTrustEvent(
          tx.sender_id,
          'transaction_completed',
          { amount: tx.amount_kes, mpesa_ref: mpesaReceiptNumber },
          'mpesa_callback'
        );
      }

      console.log(`[NEXUM MPESA] ✓ Payment completed — KES ${tx.amount_kes} — ${mpesaReceiptNumber}`);
    } else {
      // Payment failed or cancelled
      await supabase.from('transactions').update({
        status: 'failed',
      }).eq('id', tx.id);

      console.log(`[NEXUM MPESA] ✗ Payment failed — ${ResultDesc}`);
    }

    // Always acknowledge Safaricom with 200
    res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
  } catch (err) {
    console.error('[MPESA CALLBACK ERROR]', err.message);
    // Still acknowledge Safaricom
    res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
  }
});

// ─── GET /mpesa/status/:checkoutId ───────────────
router.get('/status/:checkoutId', requireAuth, async (req, res) => {
  try {
    const result = await queryStkStatus(req.params.checkoutId);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
