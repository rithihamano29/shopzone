# ShopZone – E-Commerce Web Application

A full-stack online store with product management and order tracking.

## Features

- **Product catalog, add to cart, checkout**: search and category filter, stock display, cart saved in the browser, delivery address at checkout
- **User login and role-based access**: JWT authentication; the first registered account becomes `admin`, all others are `user`
- **Backend APIs** for products and orders (REST, Express)
- **Database integration with MongoDB** (Mongoose)
- Stock is deducted safely at checkout, and restored when an order is cancelled
- Customers can view their orders and cancel pending ones; admins manage products and update order status (pending, shipped, delivered, cancelled) and see a stats dashboard
- Responsive layout for phone and desktop

## Setup

### 1. Create a free MongoDB Atlas database
1. Sign up at https://www.mongodb.com/cloud/atlas and create a free **M0** cluster.
2. **Database Access** > Add a database user (note the username and password).
3. **Network Access** > Add IP Address > **Allow access from anywhere** (0.0.0.0/0).
4. **Database** > Connect > Drivers > copy the connection string. It looks like
   `mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net/`

### 2. Configure the app
Copy `.env.example` to `.env` and edit it:
```
MONGODB_URI=mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net/shopzone?retryWrites=true&w=majority
JWT_SECRET=any-long-random-text
PORT=3000
```
Replace `USER` and `PASSWORD` with your database user. If the password has special characters (like `@`), URL-encode them. Put `/shopzone` after `.mongodb.net` so the data goes in a database called shopzone.

### 3. Run
```bash
npm install
npm start
```
Open http://localhost:3000. Six sample products are added automatically on first start.

### 4. Try it
1. Register the **first** account: this is the admin. Open **Admin** to add, edit or delete products and manage orders.
2. Register a second account in another browser (or private window) to shop as a normal user: add items to the cart, check out, view **My Orders**.
3. Back in the admin account, change the order status and watch it update for the customer.

## API

| Method | Endpoint | Access | Description |
|---|---|---|---|
| POST | `/api/auth/register` | public | Create account |
| POST | `/api/auth/login` | public | Log in, returns JWT |
| GET | `/api/auth/me` | user | Current user |
| GET | `/api/products` | public | List products (`?q=`, `?category=`) |
| GET | `/api/products/:id` | public | One product |
| POST | `/api/products` | admin | Create product |
| PUT | `/api/products/:id` | admin | Update product |
| DELETE | `/api/products/:id` | admin | Delete product |
| POST | `/api/orders` | user | Checkout (prices and stock verified on the server) |
| GET | `/api/orders` | user | My orders (`?all=1` for admin) |
| POST | `/api/orders/:id/cancel` | user | Cancel own pending order |
| PUT | `/api/orders/:id/status` | admin | Update order status |
| GET | `/api/admin/stats` | admin | Users, products, orders, revenue |

## Project structure
```
server.js          Express API, MongoDB models, auth, orders
public/index.html  Single-page UI shell
public/styles.css  Responsive styles
public/app.js      Storefront, cart, orders and admin screens
.env.example       Environment variable template
```
