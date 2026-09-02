# AutoRick: Tour of India — Portal Submission Guide

Use the pre-filled metadata and instructions below when submitting to the **CrazyGames Developer Portal** and **Poki for Developers**.

---

## 1. Quick Game Metadata (Copy & Paste)

- **Game Title**: `AutoRick: Tour of India`
- **Short Description (Tagline)**:
  > Zip through iconic Indian city streets in an authentic Auto-Rickshaw! Weave past BEST buses, sacred cows, and yellow cabs in this high-energy 3D arcade runner.
- **Long Description**:
  > Experience the authentic hustle and bustle of Indian traffic in **AutoRick: Tour of India**! Hop into your three-wheeled tuk-tuk and tour iconic routes across Mumbai, Delhi, and Kolkata. 
  > 
  > Maneuver through lively traffic packed with city transit buses, Kaali-Peeli and Kolkata Ambassador taxis, commuter scooters, and bicycles. Pick up passengers and drop them off for huge rupee bonuses, seek the sacred blessing of peaceful cows on the road, and grab hot cutting chai for turbo boosts and invulnerability shields. Enjoy procedural Bollywood-style bhangra beats, energetic double-horns, and authentic street visual flair!
- **Game Controls**:
  - **Desktop Keyboard**:
    - `A` / `D` or `Left` / `Right Arrow`: Steer across lanes
    - `W` / `Up Arrow`: Accelerate / Boost
    - `S` / `Down Arrow`: Brake / Slow down
    - `Spacebar` or `H`: Honk Horn! (Alerts traffic and clears obstacles)
    - `C`: Switch Camera (3D Chase / Cockpit Windshield)
  - **Mobile Touch**:
    - On-screen touch buttons for steering left/right and honking the horn.
- **Genre / Categories**:
  - Primary: `Driving / Car Games`
  - Secondary: `Endless Runner / Arcade / Casual`
- **Tags**:
  - `auto rickshaw`, `tuk tuk`, `traffic`, `runner`, `india`, `driving`, `arcade`, `mobile`, `casual`, `kids`

---

## 2. CrazyGames Submission Steps

1. Go to [https://developer.crazygames.com](https://developer.crazygames.com) and create a free developer account (or log in).
2. Click **"Submit a Game"**.
3. Under **Game Type**, select **"HTML5 (Zip upload)"**.
4. Upload `autorick-portal-build.zip` (generated via `./build-portal-zip.sh`).
5. Copy & paste the metadata from Section 1 above.
6. Under **SDK Testing**, use their in-browser previewer:
   - Click "Drive Again" after dying to verify midgame ad triggering.
   - Click "Revive Rickshaw" to verify rewarded video ad callback.
7. Click **"Submit for Review"**. CrazyGames QA typically reviews and approves submissions within 3–5 business days.

---

## 3. Poki Submission Steps

1. Go to [https://developers.poki.com](https://developers.poki.com).
2. Register and click **"Submit Game"**.
3. Upload `autorick-portal-build.zip` and paste the description.
4. Poki editors will playtest your build and provide review feedback.
