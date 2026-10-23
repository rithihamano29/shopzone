(() => {
  const $ = id => document.getElementById(id);
  const view = $('view');
  const state = {
    token: localStorage.getItem('sz_token'),
    user: null,
    products: [],
    cart: JSON.parse(localStorage.getItem('sz_cart') || '[]'), // [{ id, qty }]
    authMode: 'login',
    editing: null,
    adminAll: false
  };

  /* ---------- helpers ---------- */
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = n => '₹' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 });
  const EMOJI = { Electronics: '🎧', Fashion: '👕', Home: '🏠' };

  async function api(path, options = {}) {
    const res = await fetch('/api' + path, {
      method: options.method || 'GET',
      headers: { 'Content-Type': 'application/json', ...(state.token ? { Authorization: 'Bearer ' + state.token } : {}) },
      body: options.body ? JSON.stringify(options.body) : undefined
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && state.token && !path.startsWith('/auth/')) { logout(); }
    if (!res.ok) throw new Error(data.error || 'Something went wrong');
    return data;
  }
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg; t.classList.remove('hidden');
    clearTimeout(toast.t);
    toast.t = setTimeout(() => t.classList.add('hidden'), 2400);
  }
  function showError(id, msg) { const e = $(id); if (e) { e.textContent = msg; e.classList.remove('hidden'); } }

  const saveCart = () => { localStorage.setItem('sz_cart', JSON.stringify(state.cart)); renderNav(); };
  const cartCount = () => state.cart.reduce((s, i) => s + i.qty, 0);
  const isAdmin = () => state.user && state.user.role === 'admin';

  /* ---------- session ---------- */
  function logout() {
    state.token = null; state.user = null;
    localStorage.removeItem('sz_token');
    renderNav();
    location.hash = '#shop';
    route();
  }
  async function restoreSession() {
    if (!state.token) return;
    try { state.user = await api('/auth/me'); } catch { state.token = null; localStorage.removeItem('sz_token'); }
  }

  /* ---------- navigation ---------- */
  function renderNav() {
    const cur = (location.hash || '#shop').slice(1);
    const link = (h, label) => `<a href="#${h}" class="${cur === h ? 'active' : ''}">${label}</a>`;
    $('nav').innerHTML = [
      link('shop', 'Shop'),
      link('cart', `Cart${cartCount() ? `<span class="pill">${cartCount()}</span>` : ''}`),
      state.user ? link('orders', 'My Orders') : '',
      isAdmin() ? link('admin', 'Admin') : '',
      state.user
        ? `<span class="muted" style="padding:0 6px">Hi, ${esc(state.user.name.split(' ')[0])}</span><button id="logoutBtn" type="button">Log out</button>`
        : link('login', 'Log in')
    ].join('');
    const lb = $('logoutBtn'); if (lb) lb.onclick = logout;
  }

  async function route() {
    const page = (location.hash || '#shop').slice(1);
    renderNav();
    if (['orders', 'admin'].includes(page) && !state.user) { location.hash = '#login'; return; }
    if (page === 'admin' && !isAdmin()) { location.hash = '#shop'; return; }
    if (page === 'login' && state.user) { location.hash = '#shop'; return; }
    ({ shop: renderShop, cart: renderCart, orders: renderOrders, admin: renderAdmin, login: renderLogin }[page] || renderShop)();
  }
  window.addEventListener('hashchange', route);

  /* ---------- login / register ---------- */
  function renderLogin() {
    const reg = state.authMode === 'register';
    view.innerHTML = `
      <div class="panel narrow">
        <h1>${reg ? 'Create account' : 'Welcome back'}</h1>
        <div class="tabs">
          <button type="button" data-mode="login" class="${reg ? '' : 'active'}">Log in</button>
          <button type="button" data-mode="register" class="${reg ? 'active' : ''}">Register</button>
        </div>
        <form id="authForm" novalidate>
          ${reg ? '<label>Name<input id="aName" type="text" autocomplete="name" placeholder="Your name"></label>' : ''}
          <label>Email<input id="aEmail" type="email" autocomplete="email" placeholder="you@example.com"></label>
          <label>Password<input id="aPass" type="password" autocomplete="${reg ? 'new-password' : 'current-password'}" placeholder="At least 6 characters"></label>
          <p id="authErr" class="error hidden" role="alert"></p>
          <button class="btn primary block" type="submit">${reg ? 'Create account' : 'Log in'}</button>
        </form>
        <p class="muted" style="font-size:.85rem;margin-bottom:0">${reg ? 'The very first account created becomes the admin.' : ''}</p>
      </div>`;
    view.querySelectorAll('.tabs button').forEach(b => b.onclick = () => { state.authMode = b.dataset.mode; renderLogin(); });
    $('authForm').onsubmit = async e => {
      e.preventDefault();
      const body = { email: $('aEmail').value.trim(), password: $('aPass').value };
      if (reg) body.name = $('aName').value.trim();
      try {
        const data = await api('/auth/' + state.authMode, { method: 'POST', body });
        state.token = data.token; state.user = data.user;
        localStorage.setItem('sz_token', data.token);
        toast('Welcome, ' + data.user.name + '!');
        location.hash = state.cart.length ? '#cart' : '#shop';
        route();
      } catch (err) { showError('authErr', err.message); }
    };
  }

  /* ---------- shop ---------- */
  let shopFilter = { q: '', category: '' };
  async function renderShop() {
    view.innerHTML = `
      <h1>Products</h1>
      <div class="filters">
        <input id="q" type="search" placeholder="Search products…" value="${esc(shopFilter.q)}">
        <select id="cat"><option value="">All categories</option></select>
      </div>
      <div id="grid" class="grid"></div>`;
    try { state.products = await api('/products'); } catch (e) { toast(e.message); }
    const cats = [...new Set(state.products.map(p => p.category))].sort();
    $('cat').innerHTML += cats.map(c => `<option ${c === shopFilter.category ? 'selected' : ''}>${esc(c)}</option>`).join('');
    const draw = () => {
      shopFilter.q = $('q').value; shopFilter.category = $('cat').value;
      const q = shopFilter.q.trim().toLowerCase();
      const list = state.products.filter(p => (!shopFilter.category || p.category === shopFilter.category) && (!q || p.name.toLowerCase().includes(q)));
      $('grid').innerHTML = list.length ? list.map(productCard).join('') : '<div class="empty" style="grid-column:1/-1">No products found.</div>';
    };
    $('q').oninput = draw; $('cat').onchange = draw;
    $('grid').onclick = e => {
      const b = e.target.closest('[data-add]'); if (!b) return;
      addToCart(b.dataset.add);
    };
    draw();
  }
  function productCard(p) {
    const stock = p.stock === 0 ? '<span class="stock out">Out of stock</span>' : p.stock <= 5 ? `<span class="stock low">Only ${p.stock} left</span>` : '<span class="stock ok">In stock</span>';
    const img = p.image ? `<img src="${esc(p.image)}" alt="${esc(p.name)}" onerror="this.parentNode.textContent='${EMOJI[p.category] || '📦'}'">` : (EMOJI[p.category] || '📦');
    return `
      <article class="product">
        <div class="thumb">${img}</div>
        <div class="product-body">
          <span class="cat">${esc(p.category)}</span>
          <h3>${esc(p.name)}</h3>
          <p>${esc(p.description)}</p>
          <div class="price">${money(p.price)}</div>
          ${stock}
          <button class="btn primary" data-add="${p._id}" ${p.stock === 0 ? 'disabled' : ''} type="button">Add to cart</button>
        </div>
      </article>`;
  }
  function addToCart(id) {
    const p = state.products.find(x => x._id === id);
    const line = state.cart.find(i => i.id === id);
    const have = line ? line.qty : 0;
    if (p && have + 1 > p.stock) return toast('No more stock available');
    if (line) line.qty++; else state.cart.push({ id, qty: 1 });
    saveCart(); toast('Added to cart');
  }

  /* ---------- cart + checkout ---------- */
  async function renderCart() {
    try { state.products = await api('/products'); } catch (e) { toast(e.message); }
    // drop items whose product no longer exists
    state.cart = state.cart.filter(i => state.products.some(p => p._id === i.id));
    saveCart();
    if (!state.cart.length) {
      view.innerHTML = '<h1>Your cart</h1><div class="empty">Your cart is empty. <a href="#shop">Continue shopping</a></div>';
      return;
    }
    const lines = state.cart.map(i => ({ ...i, p: state.products.find(p => p._id === i.id) }));
    const total = lines.reduce((s, l) => s + l.p.price * l.qty, 0);
    view.innerHTML = `
      <h1>Your cart</h1>
      <div class="cart-layout">
        <section class="panel">
          ${lines.map(l => `
            <div class="line">
              <div><b>${esc(l.p.name)}</b><div class="muted">${money(l.p.price)} each</div></div>
              <div class="qty">
                <button data-dec="${l.id}" type="button" aria-label="Decrease">−</button>
                <span>${l.qty}</span>
                <button data-inc="${l.id}" type="button" aria-label="Increase">+</button>
              </div>
              <div><b>${money(l.p.price * l.qty)}</b> <button class="btn danger small" data-rm="${l.id}" type="button">Remove</button></div>
            </div>`).join('')}
        </section>
        <aside class="panel">
          <h2>Checkout</h2>
          <div class="summary-row total"><span>Total</span><span>${money(total)}</span></div>
          <form id="checkoutForm" style="margin-top:14px" novalidate>
            <label>Delivery address<textarea id="addr" rows="3" placeholder="House no, street, city, PIN code"></textarea></label>
            <p id="coErr" class="error hidden" role="alert"></p>
            <button class="btn primary block" type="submit">${state.user ? 'Place order' : 'Log in to order'}</button>
          </form>
        </aside>
      </div>`;
    view.onclick = e => {
      const t = e.target.closest('[data-inc],[data-dec],[data-rm]'); if (!t) return;
      const id = t.dataset.inc || t.dataset.dec || t.dataset.rm;
      const line = state.cart.find(i => i.id === id); if (!line) return;
      const p = state.products.find(x => x._id === id);
      if (t.dataset.inc) { if (line.qty + 1 > p.stock) return toast('No more stock available'); line.qty++; }
      if (t.dataset.dec) line.qty--;
      if (t.dataset.rm || line.qty <= 0) state.cart = state.cart.filter(i => i.id !== id);
      saveCart(); renderCart();
    };
    $('checkoutForm').onsubmit = async e => {
      e.preventDefault();
      if (!state.user) { location.hash = '#login'; return; }
      try {
        await api('/orders', { method: 'POST', body: { items: state.cart.map(i => ({ productId: i.id, qty: i.qty })), address: $('addr').value } });
        state.cart = []; saveCart();
        toast('Order placed successfully!');
        location.hash = '#orders';
      } catch (err) { showError('coErr', err.message); }
    };
  }

  /* ---------- orders (customer + admin) ---------- */
  async function renderOrders() {
    view.onclick = null;
    view.innerHTML = '<h1>My orders</h1><p class="muted">Loading…</p>';
    let orders = [];
    try { orders = await api('/orders'); } catch (e) { return toast(e.message); }
    view.innerHTML = '<h1>My orders</h1>' + (orders.length ? orders.map(o => orderCard(o, false)).join('') : '<div class="empty">No orders yet. <a href="#shop">Start shopping</a></div>');
    view.onclick = async e => {
      const b = e.target.closest('[data-cancel]'); if (!b) return;
      if (!confirm('Cancel this order?')) return;
      try { await api(`/orders/${b.dataset.cancel}/cancel`, { method: 'POST' }); toast('Order cancelled'); renderOrders(); } catch (err) { toast(err.message); }
    };
  }
  function orderCard(o, admin) {
    const date = new Date(o.createdAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
    return `
      <article class="panel order">
        <div class="order-head">
          <div><b>Order #${String(o._id).slice(-6).toUpperCase()}</b> <span class="muted">· ${date}${admin ? ' · ' + esc(o.userName) : ''}</span></div>
          <span class="badge ${o.status}">${o.status}</span>
        </div>
        <ul>${o.items.map(i => `<li>${esc(i.name)} × ${i.qty} — ${money(i.price * i.qty)}</li>`).join('')}</ul>
        <div><b>Total: ${money(o.total)}</b></div>
        <div class="muted" style="font-size:.85rem">Deliver to: ${esc(o.address)}</div>
        <div class="order-actions">
          ${admin
            ? `<label style="margin:0">Status <select data-status="${o._id}">${['pending', 'shipped', 'delivered', 'cancelled'].map(s => `<option ${s === o.status ? 'selected' : ''}>${s}</option>`).join('')}</select></label>`
            : (o.status === 'pending' ? `<button class="btn danger small" data-cancel="${o._id}" type="button">Cancel order</button>` : '')}
        </div>
      </article>`;
  }

  /* ---------- admin ---------- */
  async function renderAdmin() {
    view.onclick = null;
    let stats = {}, products = [], orders = [];
    try {
      [stats, products, orders] = await Promise.all([api('/admin/stats'), api('/products'), api('/orders?all=1')]);
    } catch (e) { return toast(e.message); }
    state.products = products;
    const ed = state.editing ? products.find(p => p._id === state.editing) : null;
    view.innerHTML = `
      <h1>Admin dashboard</h1>
      <div class="stats">
        <div class="stat"><b>${stats.users}</b><span>Users</span></div>
        <div class="stat"><b>${stats.products}</b><span>Products</span></div>
        <div class="stat"><b>${stats.orders}</b><span>Orders</span></div>
        <div class="stat"><b>${money(stats.revenue)}</b><span>Revenue</span></div>
      </div>
      <div class="admin-layout">
        <section class="panel">
          <h2>${ed ? 'Edit product' : 'Add product'}</h2>
          <form id="pForm" novalidate>
            <label>Name<input id="pName" value="${esc(ed?.name)}" maxlength="120"></label>
            <label>Description<textarea id="pDesc" rows="2">${esc(ed?.description)}</textarea></label>
            <div class="row2">
              <label>Price (₹)<input id="pPrice" type="number" min="0" step="0.01" value="${ed ? ed.price : ''}"></label>
              <label>Stock<input id="pStock" type="number" min="0" step="1" value="${ed ? ed.stock : ''}"></label>
            </div>
            <label>Category<input id="pCat" value="${esc(ed?.category || '')}" placeholder="e.g. Electronics"></label>
            <label>Image URL (optional)<input id="pImg" value="${esc(ed?.image)}" placeholder="https://…"></label>
            <p id="pErr" class="error hidden" role="alert"></p>
            <button class="btn primary block" type="submit">${ed ? 'Save changes' : 'Add product'}</button>
            ${ed ? '<button id="pCancel" class="btn ghost block" type="button" style="margin-top:8px">Cancel edit</button>' : ''}
          </form>
        </section>
        <section class="panel">
          <h2>Products</h2>
          <div class="table-wrap"><table>
            <thead><tr><th>Name</th><th>Price</th><th>Stock</th><th></th></tr></thead>
            <tbody>${products.map(p => `
              <tr><td>${esc(p.name)}<div class="muted" style="font-size:.78rem">${esc(p.category)}</div></td>
              <td>${money(p.price)}</td><td>${p.stock}</td>
              <td style="white-space:nowrap"><button class="btn ghost small" data-edit="${p._id}" type="button">Edit</button>
              <button class="btn danger small" data-del="${p._id}" type="button">Delete</button></td></tr>`).join('')}
            </tbody></table></div>
        </section>
      </div>
      <h2 style="margin-top:24px">All orders</h2>
      ${orders.length ? orders.map(o => orderCard(o, true)).join('') : '<div class="empty">No orders yet.</div>'}`;

    $('pForm').onsubmit = async e => {
      e.preventDefault();
      const body = {
        name: $('pName').value, description: $('pDesc').value, price: $('pPrice').value,
        stock: $('pStock').value, category: $('pCat').value, image: $('pImg').value
      };
      try {
        if (state.editing) await api('/products/' + state.editing, { method: 'PUT', body });
        else await api('/products', { method: 'POST', body });
        toast(state.editing ? 'Product updated' : 'Product added');
        state.editing = null; renderAdmin();
      } catch (err) { showError('pErr', err.message); }
    };
    const cancel = $('pCancel'); if (cancel) cancel.onclick = () => { state.editing = null; renderAdmin(); };

    view.onclick = async e => {
      const edit = e.target.closest('[data-edit]');
      if (edit) { state.editing = edit.dataset.edit; renderAdmin(); window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
      const del = e.target.closest('[data-del]');
      if (del) {
        if (!confirm('Delete this product?')) return;
        try { await api('/products/' + del.dataset.del, { method: 'DELETE' }); toast('Product deleted'); renderAdmin(); } catch (err) { toast(err.message); }
      }
    };
    view.onchange = async e => {
      const sel = e.target.closest('[data-status]'); if (!sel) return;
      try { await api(`/orders/${sel.dataset.status}/status`, { method: 'PUT', body: { status: sel.value } }); toast('Order status updated'); renderAdmin(); }
      catch (err) { toast(err.message); renderAdmin(); }
    };
  }

  /* ---------- boot ---------- */
  restoreSession().then(route);
})();
