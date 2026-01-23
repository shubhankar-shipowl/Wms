# Warehouse Management System (WMS)

A comprehensive warehouse management system built with Node.js, React, and PostgreSQL featuring real-time inventory tracking, advanced barcode scanning with USB/Bluetooth support, AI-powered analytics, and professional warehouse operations management.

## 🚀 Key Features

### 📦 Product Management

- **Complete Product Catalog**: Define products with name, SKU, price, initial stock, HSN code, GST rate, and origin
- **Multiple Image Upload**: Upload up to 4 product images with live preview and optimization
- **Advanced Search & Filtering**: Quick product lookup with multiple search criteria
- **Bulk Operations**: Mass product updates and imports

### 📱 Advanced Barcode Scanning

- **Professional Scanner Interface**: Intuitive toggle-based operation mode selection
- **USB & Bluetooth Scanner Support**: Compatible with all standard barcode scanners
- **Dual Operation Modes**:
  - 📥 **Stock IN Mode**: Receiving, purchase orders, returns, adjustments
  - 📤 **Stock OUT Mode**: Shipping, sales orders, transfers, damage tracking
- **Real-time Product Lookup**: Instant product identification and stock verification
- **Smart Validation**: Prevents invalid operations (e.g., stock out when inventory is zero)
- **Automatic Timestamping**: All transactions logged with precise timestamps
- **Recent Transaction History**: View last transactions for scanned products

### 📊 Inventory Management

- **Real-time Stock Tracking**: Live inventory levels with automatic updates
- **Flexible Unit Allocation**: Equal split or manual distribution options
- **Low Stock Alerts**: Intelligent forecast-based alerts that predict when products will run out in the next 15 days based on average daily consumption from historical stock out data
- **Stock Movement Analytics**: Comprehensive tracking of all inventory changes
- **Multi-level Stock Validation**: Prevents overselling and stock discrepancies
- **Automated Database Backups**: Daily automated backups with cloud storage integration (Mega) - backups are automatically uploaded to Mega cloud storage

### 📈 Analytics & Reporting

- **Interactive Dashboard**: Real-time metrics and KPIs
- **Transaction History**: Comprehensive filterable logs with CSV export
- **Inventory Valuation**: Real-time stock value calculations
- **Performance Metrics**: Scanning statistics and user activity tracking
- **Custom Reports**: Flexible reporting with multiple export formats

### 🔐 Security & Access Control

- **Role-based Permissions**: Admin, User, and Viewer roles with appropriate access levels
- **JWT Authentication**: Secure token-based authentication system
- **Audit Trail**: Complete logging of all user actions and system changes
- **Session Management**: Secure session handling with automatic timeout

## Technology Stack

### Backend

- **Node.js** with Express.js framework
- **PostgreSQL** database with advanced triggers and functions
- **Socket.IO** for real-time communication
- **JWT** authentication
- **Joi** validation
- **bcryptjs** for password hashing

### Frontend

- **React 18** with functional components and hooks
- **Material-UI (MUI)** for modern UI components
- **React Query** for efficient data fetching and caching
- **React Router** for navigation
- **Recharts** for data visualization
- **Socket.IO Client** for real-time updates

## Prerequisites

- Node.js (v16 or higher)
- PostgreSQL (v12 or higher)
- npm or yarn package manager

## Installation

### 1. Clone the Repository

```bash
git clone <repository-url>
cd wms
```

### 2. Install Dependencies

```bash
# Install root dependencies
npm install

# Install server dependencies
npm run install-server

# Install client dependencies
npm run install-client
```

### 3. Database Setup

#### Create PostgreSQL Database

```sql
CREATE DATABASE wms_db;
CREATE USER wms_user WITH PASSWORD 'your_password';
GRANT ALL PRIVILEGES ON DATABASE wms_db TO wms_user;
```

#### Configure Environment Variables

```bash
# Copy the example environment file
cp server/.env.example server/.env
```

Edit `server/.env` with your database credentials:

```env
DB_HOST=localhost
DB_PORT=5432
DB_NAME=wms_db
DB_USER=wms_user
DB_PASSWORD=your_password
JWT_SECRET=your-super-secret-jwt-key
PORT=5000
CLIENT_URL=http://localhost:3000

# Mega Cloud Storage Configuration (for database backups)
MEGA_EMAIL=your-email@example.com
MEGA_PASSWORD=your-mega-password
```

#### Run Database Migrations

```bash
cd server
npm run migrate
```

This will create all necessary tables, triggers, and insert sample data including a default admin user.

### 4. Start the Application

#### Development Mode (Both servers)

```bash
npm run dev
```

#### Or start servers separately

```bash
# Terminal 1 - Backend
npm run server

# Terminal 2 - Frontend
npm run client
```

The application will be available at:

- Frontend: http://localhost:3000
- Backend API: http://localhost:5000

## Default Login Credentials

- **Username**: admin
- **Password**: admin123

## 📱 Using the Barcode Scanner

### Scanner Setup

1. **Connect Scanner**: Plug in your USB barcode scanner or pair Bluetooth scanner
2. **Access Scanner**: Navigate to the "Scanner" page in the application
3. **Select Mode**: Use the toggle buttons to choose operation mode:
   - 📥 **Stock IN**: For receiving inventory, purchase orders, returns
   - 📤 **Stock OUT**: For shipping, sales orders, transfers

### Scanning Workflow

1. **Select Operation Mode**: Toggle between Stock IN/OUT at the top of the page
2. **Scan Barcode**: Use your scanner or manually enter barcode
3. **Verify Product**: Review product details and current stock levels
4. **Enter Quantity**: Specify the quantity for the transaction
5. **Add Notes**: Optional notes for tracking purposes (order numbers, reasons, etc.)
6. **Confirm Transaction**: Complete the stock movement

### Scanner Features

- **Real-time Validation**: Prevents invalid operations (e.g., stock out with zero inventory)
- **Automatic Timestamping**: All transactions logged with precise date/time
- **Recent History**: View recent transactions for scanned products
- **Live Statistics**: Track scanning activity and performance metrics
- **Error Prevention**: Smart validation prevents common mistakes

### Compatible Scanners

- USB barcode scanners (plug-and-play)
- Bluetooth barcode scanners
- Smartphone camera scanners (manual entry)
- Any HID-compliant barcode scanner

## API Documentation

### Authentication Endpoints

- `POST /api/auth/login` - User login
- `POST /api/auth/register` - Create new user (admin only)
- `GET /api/auth/profile` - Get user profile
- `GET /api/auth/verify` - Verify JWT token

### Product Endpoints

- `GET /api/products` - Get all products with pagination and search
- `GET /api/products/:id` - Get single product with details
- `POST /api/products` - Create new product
- `PUT /api/products/:id` - Update product
- `DELETE /api/products/:id` - Delete product

### Barcode & Scanner Endpoints

- `POST /api/scanner/lookup` - Look up product by barcode
- `POST /api/scanner/update-stock` - Update stock via barcode scan
- `GET /api/scanner/scan-history` - Get barcode scanning history
- `GET /api/scanner/stats` - Get scanning statistics
- `POST /api/barcodes/suggest/:productId` - Get AI barcode quantity suggestion
- `GET /api/barcodes/suggestions` - Get pending suggestions (admin)
- `POST /api/barcodes/suggestions/respond` - Respond to suggestion (admin)
- `GET /api/barcodes/product/:productId` - Get barcodes for product
- `POST /api/barcodes` - Create single barcode
- `POST /api/barcodes/bulk` - Create multiple barcodes

### Transaction Endpoints

- `GET /api/transactions` - Get transactions with filtering
- `GET /api/transactions/:id` - Get single transaction
- `POST /api/transactions` - Create new transaction
- `POST /api/transactions/bulk` - Create multiple transactions
- `GET /api/transactions/summary/stats` - Get transaction statistics

### Inventory Endpoints

- `GET /api/inventory/overview` - Get inventory overview
- `GET /api/inventory/stock-levels` - Get real-time stock levels
- `GET /api/inventory/valuation` - Get inventory valuation report
- `GET /api/inventory/analytics` - Get stock movement analytics

### Alert Endpoints

- `GET /api/alerts/low-stock` - Get low stock alerts (forecast-based only)
  - Returns products that are:
    - Out of stock (critical alerts)
    - Predicted to run out in 15 days or less based on average daily consumption (forecast-based alerts)
  - Response includes: `avg_daily_consumption`, `days_until_stockout`, `alert_type` (forecast)
  - Critical alerts: Stock = 0 or days until stockout ≤ 3 days
- `GET /api/alerts/summary` - Get alert summary (includes forecast alert counts)
- `POST /api/alerts/check-low-stock` - Manually trigger stock check (includes forecast analysis)
- `POST /api/alerts/bulk-action` - Bulk resolve/dismiss alerts

### Dashboard Endpoints

- `GET /api/dashboard` - Get comprehensive dashboard data
- `GET /api/dashboard/metrics/realtime` - Get real-time metrics
- `GET /api/dashboard/forecast` - Get demand forecasting data

## Database Schema

### Key Tables

- **products**: Product master data
- **barcodes**: Barcode assignments per product
- **stock_transactions**: All stock movements (IN/OUT)
- **current_stock**: Real-time stock levels (updated via triggers)
- **low_stock_alerts**: Automated low stock notifications
- **barcode_suggestions**: AI-generated barcode quantity suggestions
- **users**: User authentication and authorization

### Key Features

- **Automated Stock Updates**: PostgreSQL triggers automatically update stock levels
- **Low Stock Detection**: Automatic alert generation when stock falls below thresholds
- **Data Integrity**: Foreign key constraints and check constraints ensure data consistency
- **Performance Optimization**: Strategic indexes for fast queries

## AI-Powered Features

### Barcode Quantity Suggestions

The system uses a simple AI algorithm that considers:

- Current stock levels
- Historical sales data (last 6 months)
- Seasonal factors
- Lead time requirements
- Safety stock calculations

### Demand Forecasting

- Trend-based forecasting using historical transaction data
- Stockout risk prediction
- Seasonal adjustment factors
- Days-until-stockout calculations

## Real-time Features

### WebSocket Events

- Product creation/updates
- Stock level changes
- New transactions
- Low stock alerts
- Barcode generation

### Live Dashboard Updates

- Real-time metrics refresh
- Live stock level monitoring
- Instant alert notifications

## Security Features

- JWT-based authentication
- Role-based access control (Admin, User, Viewer)
- Password hashing with bcrypt
- SQL injection prevention with parameterized queries
- CORS protection
- Input validation with Joi

## Performance Optimizations

- Database indexes on frequently queried columns
- React Query for efficient data caching
- Pagination for large datasets
- Materialized views for complex calculations
- Connection pooling for database connections

## Development

### Project Structure

```
wms/
├── server/                 # Backend Node.js application
│   ├── config/            # Database and app configuration
│   ├── middleware/        # Express middleware
│   ├── routes/           # API route handlers
│   ├── migrations/       # Database schema and migrations
│   └── index.js          # Server entry point
├── client/               # Frontend React application
│   ├── src/
│   │   ├── components/   # Reusable React components
│   │   ├── contexts/     # React contexts (Auth, Socket)
│   │   ├── pages/        # Page components
│   │   └── App.js        # Main App component
│   └── public/           # Static assets
└── package.json          # Root package.json for scripts
```

### Available Scripts

- `npm run dev` - Start both frontend and backend in development mode
- `npm run server` - Start only the backend server
- `npm run client` - Start only the frontend client
- `npm run build` - Build the frontend for production
- `npm run install-all` - Install dependencies for both frontend and backend

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Support

For support and questions, please open an issue in the GitHub repository.

## Roadmap

### Upcoming Features

- Mobile app for warehouse operations
- Barcode scanning integration
- Advanced reporting with PDF export
- Integration with external ERP systems
- Multi-warehouse support
- Advanced forecasting with machine learning
- Automated reorder point calculations
- Supplier management
- Purchase order generation
