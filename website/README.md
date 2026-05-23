# NayanSathi — Website Deployment Guide

> 🚀 Futuristic AI Startup showcase website for NayanSathi

## 📁 Folder Structure

```
website/
├── index.html          ← Main website (all CSS + JS embedded)
├── vercel.json         ← Vercel deployment config
├── images/
│   ├── hero.png                ← AI Smart Glasses hero image (exploded view)
│   ├── product-showcase.png    ← Product showcase with key specs
│   ├── hardware-diagram.png    ← Full hardware diagram
│   ├── circuit-diagram.png     ← Complete circuit/wiring diagram
│   └── day-night.png           ← Day & Night mode comparison
└── README.md
```

## 🖼️ Adding Your Images

Copy your 5 project images into the `images/` folder with EXACTLY these filenames:

| Filename | Description |
|---|---|
| `hero.png` | The NayanSathi AI glasses exploded holographic render |
| `product-showcase.png` | Product showcase with specs on the right |
| `hardware-diagram.png` | Full hardware component diagram |
| `circuit-diagram.png` | Complete circuit / wiring diagram |
| `day-night.png` | Day mode vs Night mode comparison |

## 🌐 Deploy to Vercel

### Method 1: Vercel CLI (Recommended)
```bash
# Install Vercel CLI
npm install -g vercel

# Navigate to website folder
cd website/

# Deploy
vercel --prod
```

### Method 2: Vercel Dashboard (Easiest)
1. Go to [vercel.com](https://vercel.com)
2. Click **Add New → Project**
3. Import from GitHub: `vasudevtechnologies/NayanSathi-AI-Smart-Glasses`
4. Set **Root Directory** to `website`
5. Click **Deploy** ✅

### Method 3: Drag & Drop
1. Go to [vercel.com/new](https://vercel.com/new)
2. Drag the entire `website/` folder into Vercel
3. Done!

## ✅ Website Sections

- 🎬 **Hero** — Cinematic hero with live HUD stats
- ✨ **Features** — 9 feature cards with glow hover effects
- 🖼️ **Product Showcase** — Full-width product image + specs
- 🔄 **System Architecture** — Animated flow diagram
- 🔧 **Hardware Diagram** — Your actual hardware image
- 📊 **Live Dashboard** — Animated fake dashboard with canvas cam feed
- 🌙 **Day/Night Mode** — Power system showcase
- ⚡ **Circuit Diagram** — Full wiring schematic  
- 🔮 **Future Scope** — 6 roadmap cards
- 🏢 **About** — Vasudev Technologies branding
- 🦶 **Footer** — Links, social, copyright
