# Project Avatar — incremental department-budget site

## Deployment
The public pages are index.html and catalogue.html. Deploy this directory to a static host; all assets and scripts use relative paths, so it also works beneath a GitHub Pages project path. index.html is the entry point. calculator.html is a compatibility redirect. netlify.toml includes security headers; .nojekyll supports GitHub Pages. There is no build step or server-side dependency.

For local review: run `python -m http.server 8000` in this directory and visit http://localhost:8000. Serve over HTTPS for public use. Do not deploy secrets. No backend writes, analytics, third-party scripts or paid API calls are made by the site. Source/product links open only when clicked. Local browser storage retains estimates and appearance; JSON/CSV exports are user-triggered. Estimate files can contain notes; handle those appropriately.

Nothing was pushed to the linked repository. Repository/deployment ownership remains with you. This package is a deployable static cost-planning site, not a certification of the live wildfire platform, model performance, aviation authorization or field reliability.

## Branding
The supplied Project Avatar image appears in the header and links to index.html. The supplied Team Firebenders image appears in the footer of both public pages and links to https://github.com/Arpan1078/project-avatar . Optimized cropped WebP versions are used for legibility; original supplied JPEG files are retained in assets.

## Cost scope
Only incremental department expenses are included. Existing fire vehicles, ordinary response, existing stock, power and internet are not repurchased by default. Department/partner responder wages and salary/opportunity-cost imputations are not calculated. The only hourly paid-work input is explicitly APPLICATION-only work, default 0 hours.

Software is assumed supplied/basically done by the user: completion cost $0, support retainer $0/month, final app configuration $200 once and hosting/data $12/month. These are editable planning assumptions, not a service quote or independent finding that the repository's application is complete. The retrieved public repository showed the ingestion scripts and README; it did not establish deployed-system readiness.

Aircraft retail prices were not artificially reduced. Basic remote-pilot course/test fees start at a $250/person allowance; obtain actual fees. Additional insurance/rider starts at $500/year and extra maintenance at $150/aircraft/year; obtain insurer/vendor quotes. Existing confirmed policy coverage can exclude the additional premium. Hosting can be excluded if supplied. Existing qualified pilots can have new-course count set to zero. These cost choices do not waive regulatory or safety requirements.

Default incremental first-year example (one new Autel kit, two trainees, new insurance allowance, minimal app setup, station power/internet already available): about $7,728 including reserves, at entered reference prices. Using an existing thermal aircraft under the same other assumptions is about $1,899. These are estimates, not quotes, and incomplete/unconfirmed arrangements remain flagged.

## Kansas aviation and aid evidence
KFS explicitly uses contracted aircraft for wildfire suppression:
https://www.kansasforests.org/fire/firedepartmentsupport.html
https://www.kansasforests.org/fire/fire_documents/Kansas%20Forest%20Service%20Aviation%20Resource%20Guide.pdf

A documented Kansas agricultural pilot is also a volunteer firefighter, but aircraft services have been contracted as needed:
https://wildfiretoday.com/kansas-has-a-second-s-2-available/

Therefore the site does NOT assume agricultural firefighting is universally donated. It offers volunteer pilot/donated services, agency coordination, or operating-expense reimbursement. No pilot wages are added. Fuel, maintenance and aircraft insurance can still be payable. Full zero-cost operation needs an explicitly confirmed donation/funding agreement; unconfirmed assumptions remain flagged. Rate $150/flight-hour is an editable operating-expense placeholder, not a published Kansas contract price or wage. Aircraft type and actual agreement can differ substantially. Initial commercial/ag pilot licensing, aircraft ownership and salaried/standby pilot work are not priced.

Kansas Fire Marshal describes compensation of contracted departments:
https://www.firemarshal.ks.gov/389/Wildland-Fire

Mutual aid is included as existing response capacity with delay, not new fleet purchase or guaranteed arrival. Enter only EXTRA obligations the department owes; availability, agreements and timing must be confirmed. Do not treat all mutual aid or state resources as universally free. Assistance contact/source:
https://www.kansasforests.org/fire/wildfireresponse.html

Cottonwood Creek facts come from the supplied fictional Firewatch kickoff: 450 sq mi, 18 volunteers, 5 available weekdays, existing brush trucks/tanker, weak cell/no fiber and long road travel. Aid time defaults to a 35-minute scenario assumption within the deck's 30–40-minute example. Other Kansas presets are illustrative—not actual agency budgets or staffing records.

## Water and supplies
Existing hydrant/tank access, ponds/lakes and rivers/streams can be selected. No purchase cost is assigned to a natural water body. New pump/adapters/access works are optional. Confirm rights/owner or agency permission, seasonal depth/flow, contamination/agent restrictions, bank/vehicle access, pump lift and safe setup. A mapped water body is not automatically usable or permission to withdraw.

No assumption is made that every department has long-term retardant stock. KFS aviation guidance describes water drops and local refilling, not universal retardant inventories. Existing selected stock is not charged; only explicit additional purchases/replenishment are included. Extra use may require future replenishment. No operating cost is made free merely by excluding existing inventory value.

Suppression hardware/retrofitting remains experimental and engineering-dependent. CO2 pressure systems remain R&D, not established outdoor wildfire suppression. New installations still need engineering, permissions, electrical compatibility, insurance and aviation review. Existing kit selection excludes acquisition only, not newly required validation.

## Accounting and safety
One-year default. Startup includes new costs, tax and contingency. Annual costs include only selected incremental expenses and annual reserve. In longer horizons, escalation is 3%; a 5-year aircraft cycle first replaces in year 6. Bundled batteries are not renewed again when the aircraft package is replaced. Existing asset age is not separately modeled. No depreciation, financing, salvage or speculative fire/property savings are included. Taxes on services and local extras belong in entered quotes/custom costs.

The UI retains concise safety/quote/confirmation checks but removes technical packaging boilerplate. No estimate means approved procurement, available aircraft, guaranteed aid response, approved drone flight, certified wildfire detection or safe agent release.

## Validation
32 calculation tests and 19 automated Chromium checks passed. Checks cover default costs, unchanged aircraft price, reuse of inventory/infrastructure, zero responder wages, app-only paid work, extra consumables, natural water checks, donated aviation confirmation, mutual-aid obligations, schedules, grants, logos/links, dark/light, mobile, exports/imports and print layout. Test output is in TEST_RESULTS.txt.

Run `node test_engine.js` for calculation checks. Browser tests were run against the served local site. Static-host security header behavior, every browser, live provider prices and a real fire operation have not been independently certified.
