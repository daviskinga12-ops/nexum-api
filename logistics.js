const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const supabase = require('../lib/supabase');
const { requireAuth } = require('../middleware/auth');

// ─── POST /logistics/orders — Create delivery order ─
router.post('/orders', requireAuth, async (req, res) => {
  try {
    const { pickup_location, delivery_location, distance_km } = req.body;

    if (!pickup_location || !delivery_location) {
      return res.status(400).json({ error: 'pickup_location and delivery_location required' });
    }

    // Calculate fee based on distance
    const fee_kes = distance_km
      ? Math.max(50, Math.min(300, Math.round(distance_km * 20)))
      : 100;

    // Generate tracking code
    const tracking_code = 'NXL-' + uuidv4().replace(/-/g, '').slice(0, 8).toUpperCase();

    const { data: order, error } = await supabase
      .from('logistics_orders')
      .insert({
        seller_id: req.userId,
        pickup_location,
        delivery_location,
        distance_km: distance_km || null,
        fee_kes,
        status: 'pending',
        tracking_code,
      })
      .select()
      .single();

    if (error) throw error;

    res.status(201).json({
      message: 'Order created. A verified rider will be assigned shortly.',
      order_id: order.id,
      tracking_code: order.tracking_code,
      fee_kes: order.fee_kes,
      status: order.status,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /logistics/orders/:id — Track order ─────
router.get('/orders/:id', requireAuth, async (req, res) => {
  try {
    const { data: order } = await supabase
      .from('logistics_orders')
      .select('*, rider:rider_id(nexum_id, full_name)')
      .eq('id', req.params.id)
      .single();

    if (!order) return res.status(404).json({ error: 'Order not found' });

    // Verify ownership
    if (order.seller_id !== req.userId && order.buyer_id !== req.userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    res.json(order);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /logistics/orders — List my orders ───────
router.get('/orders', requireAuth, async (req, res) => {
  try {
    const { data: orders } = await supabase
      .from('logistics_orders')
      .select('id, tracking_code, pickup_location, delivery_location, fee_kes, status, created_at')
      .eq('seller_id', req.userId)
      .order('created_at', { ascending: false })
      .limit(20);

    res.json({ orders: orders || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
