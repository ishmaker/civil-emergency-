# Civil Emergency Connect (CEC v5)

Offline-first emergency coordination system built for disaster and campus crisis scenarios.

Designed to operate **without internet**, using LAN / Hotspot connectivity.

---

## Problem Statement

In disaster situations, internet infrastructure often fails.  
Civil Emergency Connect allows one device to act as a local emergency server while nearby devices connect via WiFi hotspot or LAN to:

- Report emergencies
- Mark themselves safe
- View real-time alerts
- Verify reports
- Export structured data

All without relying on cloud services.

---

## Core Features

### Smart Trust Scoring
- Photo evidence bonus
- GPS accuracy weighting
- WiFi signal strength weighting
- Community vouch system
- Adaptive “rural mode” thresholds

### Security & Abuse Protection
- Bot detection (User-Agent + heuristic checks)
- IP-based rate limiting
- Synthetic request detection
- Bot cluster fingerprint detection
- Geo-temporal ambush pattern detection

### Intelligent Triage
Keyword-based categorization:
- MEDICAL
- FIRE
- TRAPPED
- FLOOD
- MISSING
- FOOD_WATER
- SAFE

Each category provides instant first-aid guidance.

### Fully Offline Capable
- LAN / Hotspot sharing
- No external APIs required
- No database dependency
- File-based persistence

### Data Management
- JSON-based local storage
- CSV export
- JSON export
- Safe memory limits for photo uploads
- Auto-recovery on restart

---

## Architecture

- Node.js (native HTTP server)
- Cluster module (multi-core scaling)
- In-memory alert store
- File-based persistence (`alerts_data.json`)
- Static frontend (HTML/CSS/JS)

Master process spawns worker processes equal to CPU cores for improved concurrency.

---

## Project Structure
civil-emergency-connect/
│
├── server.js
├── package.json
├── README.md
├── .gitignore
├── .gitattributes
│
└── public/
└── index.html

---

## Installation

```bash
npm install
node server.js