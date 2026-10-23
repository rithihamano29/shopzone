require('dotenv').config();
const express = require('express');
const path = require('path');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'change-this-secret-in-production';
const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error('\nMONGODB_URI is missing. Copy .env.example to .env and paste your MongoDB Atlas connection string.\n');
  process.exit(1);
}

/* ---------- models ---------- */
const User = mongoose.model('User', new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true },
  role: { type: String, enum: ['user', 'admin'], default: 'user' }
}, { timestamps: true }));

const Product = mongoose.model('Product', new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 120 },
  description: { type: String, default: '', maxlength: 1000 },
  price: { type: Number, required: true, min: 0 },
  stock: { type: Number, required: true, min: 0, default: 0 },
  category: { type: String, default: 'General', trim: true },
  image: { type: String, default: '' }
}, { timestamps: true }));

const ORDER_STATUSES = ['pending', 'shipped', 'delivered', 'cancelled'];
const Order = mongoose.model('Order', new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  userName: String,
  items: [{
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
    name: String, price: Number, qty: Number
  }],
  total: Number,
  address: { type: String, required: true },
  status: { type: String, enum: ORDER_STATUSES, default: 'pending' }
}, { timestamps: true }));

/* ---------- app + helpers ---------- */
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const publicUser = u => ({ id: u._id, name: u.name, email: u.email, role: u.role });
const signToken = u => jwt.sign({ id: String(u._id), role: u.role, name: u.name }, JWT_SECRET, { expiresIn: '7d' });
const validId = id => mongoose.isValidObjectId(id);

function auth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Please log in first' });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'Session expired, please log in again' }); }
}
const adminOnly = (req, res, next) => (req.user.role === 'admin' ? next() : res.status(403).json({ error: 'Admins only' }));

/* ---------- auth ---------- */
app.post('/api/auth/register', wrap(async (req, res) => {
  const { name, email, password } = req.body || {};
  if (!name || !email || !password) return res.status(400).json({ error: 'Name, email and password are required' });
  if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: 'Enter a valid email' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  if (await User.findOne({ email: email.toLowerCase() })) return res.status(409).json({ error: 'Email already registered' });
  const isFirst = (await User.countDocuments()) === 0; // first account becomes admin
  const user = await User.create({
    name, email, passwordHash: await bcrypt.hash(password, 10), role: isFirst ? 'admin' : 'user'
  });
  res.status(201).json({ token: signToken(user), user: publicUser(user) });
}));

app.post('/api/auth/login', wrap(async (req, res) => {
  const { email, password } = req.body || {};
  const user = await User.findOne({ email: String(email || '').toLowerCase() });
  if (!user || !(await bcrypt.compare(password || '', user.passwordHash))) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  res.json({ token: signToken(user), user: publicUser(user) });
}));

app.get('/api/auth/me', auth, wrap(async (req, res) => {
  const user = await User.findById(req.user.id);
  if (!user) return res.status(401).json({ error: 'User no longer exists' });
  res.json(publicUser(user));
}));

/* ---------- products ---------- */
function cleanProduct(body) {
  const p = {
    name: String(body.name || '').trim(),
    description: String(body.description || '').trim(),
    price: Number(body.price),
    stock: parseInt(body.stock, 10),
    category: String(body.category || 'General').trim() || 'General',
    image: String(body.image || '').trim()
  };
  if (!p.name) return { error: 'Product name is required' };
  if (!Number.isFinite(p.price) || p.price < 0) return { error: 'Enter a valid price' };
  if (!Number.isInteger(p.stock) || p.stock < 0) return { error: 'Enter a valid stock quantity' };
  return { value: p };
}

app.get('/api/products', wrap(async (req, res) => {
  const filter = {};
  if (req.query.category) filter.category = req.query.category;
  if (req.query.q) {
    const safe = String(req.query.q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.name = new RegExp(safe, 'i');
  }
  res.json(await Product.find(filter).sort({ createdAt: -1 }));
}));

app.get('/api/products/:id', wrap(async (req, res) => {
  if (!validId(req.params.id)) return res.status(404).json({ error: 'Product not found' });
  const p = await Product.findById(req.params.id);
  if (!p) return res.status(404).json({ error: 'Product not found' });
  res.json(p);
}));

app.post('/api/products', auth, adminOnly, wrap(async (req, res) => {
  const { error, value } = cleanProduct(req.body || {});
  if (error) return res.status(400).json({ error });
  res.status(201).json(await Product.create(value));
}));

app.put('/api/products/:id', auth, adminOnly, wrap(async (req, res) => {
  if (!validId(req.params.id)) return res.status(404).json({ error: 'Product not found' });
  const { error, value } = cleanProduct(req.body || {});
  if (error) return res.status(400).json({ error });
  const p = await Product.findByIdAndUpdate(req.params.id, value, { new: true, runValidators: true });
  if (!p) return res.status(404).json({ error: 'Product not found' });
  res.json(p);
}));

app.delete('/api/products/:id', auth, adminOnly, wrap(async (req, res) => {
  if (!validId(req.params.id)) return res.status(404).json({ error: 'Product not found' });
  const p = await Product.findByIdAndDelete(req.params.id);
  if (!p) return res.status(404).json({ error: 'Product not found' });
  res.json({ ok: true });
}));

/* ---------- orders ---------- */
// Checkout: prices and stock are always taken from the database, never from the browser.
app.post('/api/orders', auth, wrap(async (req, res) => {
  const { items, address } = req.body || {};
  if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: 'Your cart is empty' });
  if (!address || !String(address).trim()) return res.status(400).json({ error: 'Delivery address is required' });

  // merge duplicate lines
  const wanted = new Map();
  for (const it of items) {
    const qty = parseInt(it.qty, 10);
    if (!validId(it.productId) || !Number.isInteger(qty) || qty < 1) return res.status(400).json({ error: 'Invalid cart item' });
    wanted.set(it.productId, (wanted.get(it.productId) || 0) + qty);
  }

  const reserved = []; // { product, qty } already deducted, for rollback
  const lines = [];
  try {
    for (const [productId, qty] of wanted) {
      // atomic: only deduct when enough stock remains
      const p = await Product.findOneAndUpdate(
        { _id: productId, stock: { $gte: qty } },
        { $inc: { stock: -qty } },
        { new: true }
      );
      if (!p) {
        const exists = await Product.findById(productId);
        throw Object.assign(new Error(exists ? `Only ${exists.stock} left of "${exists.name}"` : 'A product in your cart no longer exists'), { status: 400 });
      }
      reserved.push({ id: productId, qty });
      lines.push({ product: p._id, name: p.name, price: p.price, qty });
    }
  } catch (err) {
    for (const r of reserved) await Product.updateOne({ _id: r.id }, { $inc: { stock: r.qty } });
    return res.status(err.status || 500).json({ error: err.message });
  }

  const total = Math.round(lines.reduce((s, l) => s + l.price * l.qty, 0) * 100) / 100;
  const order = await Order.create({
    user: req.user.id, userName: req.user.name, items: lines, total, address: String(address).trim()
  });
  res.status(201).json(order);
}));

app.get('/api/orders', auth, wrap(async (req, res) => {
  const filter = req.user.role === 'admin' && req.query.all === '1' ? {} : { user: req.user.id };
  res.json(await Order.find(filter).sort({ createdAt: -1 }));
}));

app.put('/api/orders/:id/status', auth, adminOnly, wrap(async (req, res) => {
  const { status } = req.body || {};
  if (!ORDER_STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status' });
  if (!validId(req.params.id)) return res.status(404).json({ error: 'Order not found' });
  const order = await Order.findById(req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  if (order.status === 'cancelled' && status !== 'cancelled') return res.status(400).json({ error: 'Cancelled orders cannot be reopened' });
  if (status === 'cancelled' && order.status !== 'cancelled') {
    for (const it of order.items) await Product.updateOne({ _id: it.product }, { $inc: { stock: it.qty } }); // restock
  }
  order.status = status;
  await order.save();
  res.json(order);
}));

// a customer can cancel their own order while it is still pending
app.post('/api/orders/:id/cancel', auth, wrap(async (req, res) => {
  if (!validId(req.params.id)) return res.status(404).json({ error: 'Order not found' });
  const order = await Order.findById(req.params.id);
  if (!order || String(order.user) !== req.user.id) return res.status(404).json({ error: 'Order not found' });
  if (order.status !== 'pending') return res.status(400).json({ error: 'Only pending orders can be cancelled' });
  for (const it of order.items) await Product.updateOne({ _id: it.product }, { $inc: { stock: it.qty } });
  order.status = 'cancelled';
  await order.save();
  res.json(order);
}));

app.get('/api/admin/stats', auth, adminOnly, wrap(async (req, res) => {
  const [users, products, orders, revenue] = await Promise.all([
    User.countDocuments(), Product.countDocuments(), Order.countDocuments(),
    Order.aggregate([{ $match: { status: { $ne: 'cancelled' } } }, { $group: { _id: null, total: { $sum: '$total' } } }])
  ]);
  res.json({ users, products, orders, revenue: revenue[0] ? revenue[0].total : 0 });
}));

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  console.error(err);
  res.status(500).json({ error: 'Server error, please try again' });
});

/* ---------- sample data + start ---------- */
async function seedProducts() {
  if (await Product.countDocuments()) return;
  await Product.insertMany([
    { name: 'Wireless Headphones', description: 'Bluetooth over-ear headphones with 30-hour battery life.', price: 1999, stock: 25, category: 'Electronics' },
    { name: 'Smart Watch', description: 'Fitness tracking, heart-rate monitor and notifications.', price: 2999, stock: 15, category: 'Electronics' },
    { name: 'Cotton T-Shirt', description: 'Soft, breathable everyday cotton t-shirt.', price: 399, stock: 60, category: 'Fashion' },
    { name: 'Running Shoes', description: 'Lightweight shoes with cushioned sole.', price: 1499, stock: 30, category: 'Fashion' },
    { name: 'Steel Water Bottle', description: 'Insulated 750 ml bottle keeps drinks cold for 24 hours.', price: 599, stock: 40, category: 'Home' },
    { name: 'Desk Lamp', description: 'LED desk lamp with 3 brightness levels.', price: 799, stock: 20, category: 'Home' }
  ]);
  console.log('Added sample products');
}

mongoose.connect(MONGODB_URI)
  .then(async () => {
    console.log('Connected to MongoDB');
    await seedProducts();
    app.listen(PORT, () => console.log(`ShopZone running at http://localhost:${PORT}`));
  })
  .catch(err => {
    console.error('\nCould not connect to MongoDB:', err.message);
    console.error('Check your MONGODB_URI in .env, your Atlas username/password, and that Network Access allows your IP.\n');
    process.exit(1);
  });
