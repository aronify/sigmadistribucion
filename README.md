# Sigma Shpërndarje - Package Tracking System

A modern, responsive web application for internal package tracking with barcode scanning, inventory management, and multi-language support (English/Albanian).

## 🚀 Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Environment Setup
Create a `.env.local` file in the root directory:
```env
VITE_SUPABASE_URL=https://rfzkpgtancqsjxivrnts.supabase.co
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
```

### 3. Database Setup
1. Go to your [Supabase Dashboard](https://app.supabase.com)
2. Open SQL Editor
3. Run the SQL script from `supabase/COMPLETE_SETUP.sql`

### 4. Start Development Server
```bash
npm run dev
```

Visit: http://localhost:5173

### 5. Login
- **Admin:** PIN `123456` or `654321`
- **User:** PIN `111111`, `222222`, or `333333`

## ✨ Features

- ✅ PIN-based authentication
- ✅ Create packages with recipient information
- ✅ Thermal label printing (50mm x 30mm)
- ✅ QR code generation for packages
- ✅ Camera-based barcode scanning
- ✅ Package status tracking workflow
- ✅ Inventory management (read-only view)
- ✅ Admin panel (user/product/package management)
- ✅ Multi-language support (English/Albanian)
- ✅ Responsive design (desktop & mobile)

## 📁 Project Structure

```
SIGMAAA/
├── src/
│   ├── App.tsx                    # Main application component
│   ├── main.tsx                   # Application entry point
│   ├── index.css                  # Global styles
│   ├── components/                # Reusable components
│   │   ├── BarcodeScanner.tsx    # Camera barcode scanner
│   │   ├── LanguageSwitcher.tsx  # Language toggle (EN/AL)
│   │   └── ConfirmationDialog.tsx # Confirmation dialogs
│   └── lib/                       # Core libraries
│       ├── auth.tsx              # Authentication context
│       ├── i18n.ts               # Internationalization
│       ├── supabase.ts           # Supabase exports
│       └── supabaseClient.ts     # Supabase client setup
├── public/                        # Static assets
│   └── favicon.png
├── supabase/
│   └── COMPLETE_SETUP.sql        # Database schema
├── cypress/                       # E2E tests
├── package.json
├── vite.config.ts
├── vercel.json                    # Vercel configuration
└── README.md
```

## 🎯 Usage

### For Standard Users
1. **Login** with your 6-digit PIN
2. **Create Label** - Create new packages and print labels
3. **Scan & Update** - Scan barcodes to update package status
4. **View Packages** - Browse and print labels for existing packages
5. **View Inventory** - Check stock levels (read-only)

### For Administrators
- All standard user features plus:
- **Admin Panel** - Manage users, products, packages, and view audit logs

## 🌍 Language Support

The app supports two languages:
- **English (EN)** - Default
- **Albanian (AL)** - Full translation

Click the language switcher in the top-right corner to change language.

## 🖨️ Printing

The app supports thermal printer labels (50mm x 30mm landscape):
- Labels include: Logo, Package Code, QR Code, Recipient info
- Print directly from browser print dialog
- Optimized for thermal printers

## 🛠️ Tech Stack

- **Frontend:** React 18 + TypeScript + Vite
- **Styling:** Tailwind CSS
- **Backend:** Supabase (PostgreSQL + Auth)
- **Barcode:** html5-qrcode library
- **QR Codes:** qrcode library
- **Internationalization:** react-i18next
- **UI Components:** Lucide React icons

## 📦 Deployment

### Deploy to Vercel (Recommended)

#### Method 1: Via Dashboard

1. **Push to GitHub**
   ```bash
   git add .
   git commit -m "Ready for deployment"
   git push origin main
   ```

2. **Sign in to Vercel**
   - Go to [vercel.com](https://vercel.com)
   - Click "Sign Up" → Choose "Continue with GitHub"
   - Authorize Vercel to access your GitHub

3. **Import Your Project**
   - Click "Add New..." → "Project"
   - Find your repository → Click "Import"
   - Vercel will auto-detect Vite settings ✅

4. **Configure Environment Variables** ⚠️ **CRITICAL: Do this BEFORE deploying!**
   - In the project setup page, scroll to "Environment Variables"
   - Add Variable 1:
     - **Name:** `VITE_SUPABASE_URL`
     - **Value:** `https://rfzkpgtancqsjxivrnts.supabase.co`
     - **Environments:** ✅ Production ✅ Preview ✅ Development
   - Add Variable 2:
     - **Name:** `VITE_SUPABASE_ANON_KEY`
     - **Value:** Your Supabase anon key
     - **Environments:** ✅ Production ✅ Preview ✅ Development

5. **Deploy**
   - Scroll to bottom
   - Click "Deploy"
   - Wait 2-3 minutes for build to complete
   - ✅ Your app will be live at `your-project.vercel.app`

#### Method 2: Via CLI

```bash
# Install Vercel CLI
npm install -g vercel

# Login
vercel login

# Deploy
vercel

# Add environment variables
vercel env add VITE_SUPABASE_URL
vercel env add VITE_SUPABASE_ANON_KEY

# Deploy to production
vercel --prod
```

### Environment Variables Requirements

⚠️ **Critical:**
- Variable names **MUST** start with `VITE_` prefix
- Must enable for **ALL environments** (Production, Preview, Development)
- Must **redeploy** after adding variables

### Build Configuration

The project includes `vercel.json` with:
- SPA routing configuration
- Static asset caching headers
- Proper rewrites for client-side routing

**Recommended Settings:**
- Framework Preset: Vite
- Build Command: `npm run build`
- Output Directory: `dist`
- Node.js Version: 18.x or 20.x

### Local Build Test

Before deploying, test locally:
```bash
npm run build
npm run preview
```

If this works locally, the issue is Vercel configuration, not your code.

## 🔒 Security

- Environment variables are not committed (`.env.local` is gitignored)
- Row Level Security (RLS) enabled in Supabase
- Role-based access control for admin features
- PIN-based authentication
- Logo served from Supabase Storage (not exposed in code)

## 🐛 Troubleshooting

### White Screen After Deployment

**Cause:** Missing or incorrect environment variables

**Fix:**
1. Verify variables in Vercel Settings → Environment Variables
2. Check variable names: `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`
3. Ensure enabled for all environments
4. Clear build cache and redeploy

### Environment Variables Not Working

**Fix:**
1. Delete and re-add variables (copy-paste names to avoid typos)
2. Verify names exactly: `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`
3. Enable for all environments
4. Clear build cache
5. Redeploy without cache

### Build Fails

Check build logs in Vercel (Deployments → Build Logs)
- Missing dependencies → Should auto-install
- TypeScript errors → Fix in code
- Build timeout → Shouldn't happen (build is fast)

### Logo Shows 404

Logo is served from Supabase Storage. If you see 404s:
1. Hard refresh browser: `Ctrl+Shift+R` (Windows) or `Cmd+Shift+R` (Mac)
2. Clear browser cache
3. Check Network tab - should show Supabase Storage URL
4. Verify in console - should see `[Logo] getLogoUrl() returning: ...`

## 🧪 Testing

Run end-to-end tests:
```bash
npm run test        # Run tests headless
npm run test:open   # Open Cypress UI
```

## 📝 License

Internal use only - Sigma Distribution

---

**Need Help?**
1. Ensure `.env.local` is configured
2. Run `COMPLETE_SETUP.sql` in Supabase
3. Check browser console for errors
4. Verify environment variables in Vercel
# sigmadistribucion
