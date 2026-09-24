# How to add a business to Jobaro

Each business has one small settings file. It holds the business's name, colour, where enquiries are sent, and the questions and prices for each service. You don't need to write any code.

It takes about 20 minutes. Keep the two example files open while you work:

- `businesses/demo-cleaning.json` – services with instant prices
- `businesses/demo-driveways.json` – services that need a site visit instead of a price

---

## 1. Set up where enquiries are sent (Formspree)

Jobaro sends each enquiry through Formspree, which emails it to the business.

1. Go to [formspree.io](https://formspree.io) and sign in.
2. Click **New form**. Name it after the business, for example "Tidewell Cleaning quotes".
3. Set the email address to the **business's** inbox, so enquiries go straight to them.
4. Copy the form's address. It looks like `https://formspree.io/f/abcdwxyz`.

The first enquiry to a new Formspree form sends a confirmation email to that inbox. Ask the business to click the link in it, or later enquiries won't arrive.

## 2. Copy an example file

1. In the `businesses` folder, copy `demo-cleaning.json` (or `demo-driveways.json` if the business mostly needs site visits).
2. Rename the copy to the business's ID. Use lowercase letters, numbers and dashes only, for example `tidewell-cleaning.json`. The ID is the file name without `.json`.

## 3. Fill in the business details

At the top of the file:

| Setting | What to put | Example |
|---|---|---|
| `id` | The same ID as the file name | `"tidewell-cleaning"` |
| `businessName` | The name customers see | `"Tidewell Cleaning Co."` |
| `initials` | 1–2 letters shown in the coloured square | `"TC"` |
| `brandColour` | The business's main colour, as a colour code starting with `#` | `"#0F5257"` |
| `email` | The business's email. Customers see it only if sending fails. | `"bookings@tidewell.co.uk"` |
| `formEndpoint` | The Formspree address from step 1 | `"https://formspree.io/f/abcdwxyz"` |
| `privacyNote` | One or two sentences shown under the contact details | `"Your details are only shared with Tidewell…"` |

**Delete the line `"demo": true,`** in a real business's file. It adds a "Demo" label to the form.

To find a colour code, use a free colour picker browser extension on the business's website. Or search "colour picker" in Google.

## 4. Set up the services

`services` is a list. Each service looks like this:

```json
{
  "name": "End of tenancy clean",
  "mode": "price",
  "questions": [ ... ],
  "pricing": { "base": 105, "rangePercent": 8 }
}
```

- **name** – what customers pick on the first screen. If there's only one service, that screen is skipped.
- **mode** – `"price"` shows an instant price range. `"visit"` shows no price and asks for up to three preferred visit dates instead. Use `"visit"` for jobs you can't price without seeing them.
- **questions** – asked one at a time, in the order you list them.
- **pricing** – only needed for `"price"` services (see step 6).

Customers are always asked for their name, phone number, email and postcode at the end. You don't need to add those.

## 5. Write the questions

Every question needs a `type` and a `label` (the question text). You can also add:

- `help` – a line of smaller text under the question
- `id` – a short name used in the price summary, for example `"condition"`

| Type | What the customer sees | Extra settings |
|---|---|---|
| `"single"` | Pick one option | `options` |
| `"multiple"` | Pick any number (good for extras). Optional unless you add `"required": true`. | `options` |
| `"counter"` | A number with − and + buttons, for bedrooms, windows and so on | `min`, `max`, `default`, `unit` (e.g. `"bedrooms"`) |
| `"size"` | An approximate size in m², with a slider | `min`, `max`, `default` |
| `"date"` | A date picker with an "I'm flexible" tick box | `"allowFlexible": false` removes the tick box |
| `"text"` | A free text box. Optional unless you add `"required": true`. | `placeholder` |

Options can be plain words:

```json
"options": ["Gravel", "Concrete", "Old tarmac"]
```

or have prices attached (see step 6):

```json
"options": [
  { "label": "House", "price": 0 },
  { "label": "Flat", "price": -10 }
]
```

You can add `"hint": "recently cleaned"` to an option to show small grey text next to it.

## 6. Set the prices ("price" services only)

The price is worked out like this:

1. Start with the **base** price.
2. **Add** the `price` of every option the customer picks. Use a minus number to take money off.
3. For counters, add `pricePerUnit` for every unit above `includedUnits`. For example, if the base covers 1 bedroom, set `"includedUnits": 1, "pricePerUnit": 25`: each extra bedroom adds £25.
4. For sizes, add `pricePerM2` for every m² above `includedM2` (0 if you leave it out).
5. **Multiply** by any option's `multiply`. For example, `"multiply": 1.25` on "Heavy condition" adds 25%.
6. Show a range of **± rangePercent**, rounded to the nearest £5. You can also set `"minimum": 60` so the price never goes below £60.

**Worked example (the demo end of tenancy clean):**
base £105 + 1 extra bedroom £25 + oven £25 + inside windows £25 = £180, × 1 for average condition = £180.
Shown as ±8%: **£165–£195**.

The customer is always told the final price is confirmed by the business.

## 7. Check the file

A missing comma or quote mark stops the file working. Paste the whole file into [jsonlint.com](https://jsonlint.com) and click **Validate JSON**. It shows the line of any mistake.

Common mistakes:
- a missing comma between two items
- a comma after the **last** item in a list or section
- curly quotes (“ ”) instead of straight quotes (" ")

## 8. Publish and test

1. Upload the new file to the `businesses` folder in the GitHub repository. Netlify updates the site within a minute or two.
2. Open the form directly: `https://jobaro.netlify.app/quote/?b=tidewell-cleaning` (with your ID at the end).
3. Go through every service, check the prices and send one test enquiry. Check it arrives in the business's inbox.

If something is wrong in the file, the form says **"This quote form isn't set up correctly"** and names the problem.

## 9. Add it to the business's website

Send the business (or their web designer) this line. It goes just before `</body>` on every page, or in the site's "custom code" or "footer scripts" setting in Wix, Squarespace, WordPress and so on:

```html
<script src="https://jobaro.netlify.app/widget.js" data-business="tidewell-cleaning"></script>
```

This adds a floating **Get a quote** button in the business's colour, bottom-right. It opens the form in a pop-up (full screen on phones).

Optional extras:

- **Use their own buttons.** Add `data-jobaro-open` to any existing button or link:
  `<a href="#" data-jobaro-open>Get a quote</a>`
- **Jump straight to one service.** Add the service's name in lowercase, with dashes for spaces:
  `<button data-jobaro-open="end-of-tenancy-clean">Price my clean</button>`
- **Change the button text:** add `data-label="Request a visit"` to the script line.
- **Hide the floating button** (if they only want their own buttons): add `data-button="false"`.

You can also send customers the direct link from step 8, for example in emails or on social media.

## Try the demos

- Demo cleaning website with the widget: `https://jobaro.netlify.app/demo/`
- Demo driveways website (site visits): `https://jobaro.netlify.app/demo/driveways.html`

Test enquiries from the demos go to the Jobaro inbox.
