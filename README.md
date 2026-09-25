# TempSure: Medicine Integrity Passport

**Healthtech track · Fish Tank hackathon (Devin × Hub71)**

A frozen vaccine can look perfect, get injected, and fail to protect the person who receives it. Vaccines and many medicines must stay within a narrow temperature range, usually 2–8°C, from manufacturer to patient. The record of whether they did is split across warehouses, vans, handoffs and clinics.

**TempSure gives every shipment a Medicine Integrity Passport.** The passport links the medicine to its live temperature, its custody at every handoff, early warnings, automatic quarantine and a qualified decision, all in one tamper-evident record that anyone can open by scanning a QR code.

## What the demo does

| Feature | What you'll see |
|---|---|
| **Medicine Integrity Passport** | Product, lot, expiry, quantity, approved storage profile, linked sensor and current custodian |
| **Live trip simulation** | Four realistic UAE scenarios: normal delivery, loading-dock near-miss in 44°C heat, van cooling failure, silent freeze |
| **Predictive early warning** | Works out the temperature trend and warns *before* a limit is crossed ("breach in about 7 min"), including a projected-path line on the chart |
| **Human response** | A "Respond: move to validated fridge" action that the presenter can press live to save the shipment |
| **Automatic quarantine** | A confirmed excursion puts the exact lot on hold and notifies the assessor |
| **Silent-freeze detection** | Flags readings at 0°C or below on freeze-sensitive products, where damage is invisible |
| **Evidence report** | Answers the five questions (which medicine, what happened, where, who was responsible, what was decided). Downloadable and printable |
| **Qualified decision** | A pharmacist, QA, manufacturer or authority records Release, Return or Dispose. TempSure never decides on its own |
| **Tamper-evident audit log** | Every event is sealed with a SHA-256 hash chain. "Simulate tampering" shows the chain breaking |
| **QR passport on any phone** | The QR code opens a mobile, read-only snapshot of the passport (status, chart, latest events, integrity seal) |
| **Pharma-grade metrics** | Mean kinetic temperature (USP <1079>), peak and low, and minutes out of range |

## Run it

It's a static site with no build step and no dependencies to install.

- **Locally:** open `index.html` in a browser, or run `python -m http.server` in this folder and visit `http://localhost:8000`.
- **Live (needed for phone QR scanning):** see "Deploy" below.

## Deploy with GitHub Pages (about 2 minutes)

1. Push this folder to GitHub.
2. In the repo, go to **Settings → Pages**.
3. Under **Source**, choose **Deploy from a branch**, then **main**, then **/ (root)**, and click **Save**.
4. After about a minute the site is live at `https://<username>.github.io/<repo>/`. The QR codes point there automatically.

Vercel or Netlify work too: import the repo with no build command and `.` as the output directory.

## 5-minute demo script

1. **Problem (30 s):** "A frozen vaccine looks perfect but may not protect a child. Today the evidence is scattered across companies."
2. **Dashboard (20 s):** four shipments with statuses: delivered, quarantined (silent freeze), disposed.
3. **Live near-miss (90 s):** open **TS-0138**, set 2×, press **Start trip**. The doors open at the dock, the early warning fires, the team responds, and the shipment is delivered in range.
4. **Breach (90 s):** press **Reset**, choose **Breach: cooling failure**, and start. Point at the warning and don't respond. The shipment is quarantined automatically, the evidence report appears, and the pharmacist records **Dispose**.
5. **Trust (30 s):** click **Simulate tampering**. The chain breaks. Scan the QR code with a phone to show the passport.
6. **Close (20 s):** pilot on one UAE pharmacy home-delivery route, then connect to national medicine track-and-trace, then expand to fragile immunisation supply chains.

## What's real and what's simulated

- **Simulated:** the sensor feed only. Temperatures come from a physical heat-transfer model for each scenario.
- **Working as built:** prediction, excursion detection, quarantine, MKT, evidence report, decision workflow, hash-chained audit log and QR passport.

## Tech

Plain HTML, CSS and JavaScript. SHA-256 is implemented in pure JavaScript so it works anywhere. QR codes come from [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) (MIT, bundled in `vendor/`). Demo state is saved in the browser. **Reset demo data** in the footer restores the seeded shipments.

## Roadmap

- Real logger integrations (vendor APIs, Bluetooth and NFC tags)
- Pilot: UAE distributor to pharmacy home delivery of insulin and biologics
- Link passports to national medicine track-and-trace serial numbers
- Offline-first mode for immunisation supply chains with unreliable connectivity
- Arabic and English interface

## Important

TempSure supports, but does not replace, qualified judgement. Viability decisions after an excursion depend on how long and how far the product was out of range, and involve the manufacturer or public-health authority (see CDC and WHO guidance).
