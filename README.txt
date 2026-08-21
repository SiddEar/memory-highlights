MIL0NI HIGHLIGHTS — READ-ONLY LIVE GIFT SITE

PURPOSE
This website is ONLY for Miloni to read the messages.
The existing Google Form stays exactly as it is and is NOT linked from this website.

FLOW
Friends -> existing Google Form -> existing Google Sheet
Miloni's metal QR -> this website -> live read-only letters

WHAT THE WEBSITE DOES
- Reads responses from the existing Google Sheet.
- Refreshes automatically every 30 seconds.
- Displays each response as a swipeable / scrollable handwritten index card.
- Detects a final "-Name" and formats it as the signature.
- Does not let Miloni edit or submit responses.

RESPONSE FORMAT
Message...

-Name

GOOGLE SHEET REQUIREMENT
For this static version, the response Sheet must be readable by the website:
Share -> General access -> Anyone with the link -> Viewer

CURRENT DATA SOURCE
Sheet ID: 1T3YmKwIfk_dQlfOoin5o0GP-H_yoWtfLCmte5y7520M
Sheet gid: 1557122712

DEPLOY
Deploy index.html, styles.css, and script.js together using a static host such as
Netlify, GitHub Pages, or Vercel.

ONLY AFTER THE DEPLOYED WEBSITE IS TESTED:
Change the QR.io dynamic QR destination from the Google Sheet URL to the deployed website URL.
The physical metal QR code itself does not change.

V2 DESIGN CHANGES
- Pronunciation changed to / my-low-knee /.
- Decorative hearts removed except footer heart.
- Footer changed to 'made 4 milo'.

V3 FIX
- Replaced fetch/CSV loading with Google Visualization JSONP to avoid browser CORS errors.
