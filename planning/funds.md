# Feature - Funds

I want to add a new feature, the ability for users to invest is various funds. This would exist on the main Market route immediately after Stocks in the UI

I added a mockup funds-mockup.png in /temp-assets.

Admins should have the ability to perform simple CRUD actions on each fund. By default, no funds exist until an admin creates one. There should be a new page on the /admin route called Manage Funds (after Manage App in the secondary nav)

When a fund is created, it should these configurable fields:
Name: ex. DFEXPL enforce a-z, stored and displayed as uppercase A-Z, max 6 characters
Risk: Enum Low Avg High (Low: --postive color, Avg: --accent-green color, High: --negative color)
Fee: Price
Tax: tax on profits when selling
Description: short text description
gainMultiplier: how positive gains affect fund value (gains = net gains since last snapshot \* multiplier)
lossMultiplier: same as gains but for losses
included stocks: which characters belong to the fund
number of stocks per character: configurable for each character in the fund; each character can vary

My idea is that I can create safer, less risky funds by dampening the effect of losses, or create higher-risk, higher-reward funds with increased loss and gain multipliers. I want these to be a "dumbed-down" version of an index fund. If there is anything I am overlooking with the fund creation/configuration, or any suggestions on how to improve this part or how the funds values are calculate, or configurable fields you think could enhance the experience, I want to hear your ideas. Also for the mockup, I included what I think are the very basic data a user would want to see when buying a fund. if there are any data points you think would be important, or interesting from a user persepctive, please let me know.

Each interval, I would like to calculate the net gains/losses and apply the multiplier, then store the information so it can be tracked over time. I included a sparkline chart in the mockup I would like to see, similar to the sparklines in the stocks page. I think a good starting point is the sparkline should show the previous 3 days of prices with the baseline always being the first point. as far as the UI, the sparkline should eventually fill in the space between the name title and value data, but I would like it to grow from the right.

The Buy Now button in the mockup currently has the same svg as the Trade buttons throughout the app, eg on the stocks page. I want this changed to the arrow-trend-up svg I added at the end of this document.

The details link at the bottom of the card will use a toggleable down/up-chevron svg icon. clicking this will expand the card, with a nice animated grow down effect, and the new space will simply list the included characters, the # of shares they represent in the fund, the current % of the fund value they represent, their current price

example:
Goobygoobydo 1 23.31% 242.65

Buying/selling shares in a fund:
Buying will have a fee attached. Selling will incur a tax on the gains from when the user bought the fund. Selling at a loss will incur no penalty. There should be a similar Trade modal like the existing stocks one.

Adding/Removing characters from funds:
when a character is added or removed from a fund, the shares should be rebalanced, so the total number of shares in the fund remains the same, but the ratio between the characters remains the same.

Deleting a fund:
The amount a user has currently invested in the fund will be refunded to them, penalty-free, with a notification like the one that exists when a character is toggled to hidden, with a reason included

Notification System
However, this means I want how the notifications are displayed to be changed. Currently, the Reason is not shown to the user. The new format of the notification should be

{coins} coins were (added to|removed from) your wallet. Reason: {reason}

Global add/remove coins:
Currently, most users have a balance of 0. When funds are rolled out as a feature, most people will not be able to buy them without having to liqudiate their existing stocks. At the top of the Admin -> Manage App -> Danger Zone page, I would like to add another card. Visually identical to the addcoins card on the User Profile pages, but this one will add/remove coins to all users at the same time. I will manually adjust the default starting amount for new users to account for this.

Funds UI Nav Link:
I would like a text attached to the Funds Tab that says NEW, in the --positive color, to drawn attention to the fact that it is new. I want it to last until I remove it in a future deploy

Other UI Changes:

- A new Funds card will need to be added to the user's Wallet and Profile pages, below the Holdings Card.
- I would also like the ability to export/import the Funds, so I can create them on a dev environment and then import them into prod when ready.

arrow-trend-up svg for Buy Now button:
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="size-5">
<path fill-rule="evenodd" d="M12.577 4.878a.75.75 0 0 1 .919-.53l4.78 1.281a.75.75 0 0 1 .531.919l-1.281 4.78a.75.75 0 0 1-1.449-.387l.81-3.022a19.407 19.407 0 0 0-5.594 5.203.75.75 0 0 1-1.139.093L7 10.06l-4.72 4.72a.75.75 0 0 1-1.06-1.061l5.25-5.25a.75.75 0 0 1 1.06 0l3.074 3.073a20.923 20.923 0 0 1 5.545-4.931l-3.042-.815a.75.75 0 0 1-.53-.919Z" clip-rule="evenodd" />
</svg>

chevron-down svg for Details expander
<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="size-6">
<path stroke-linecap="round" stroke-linejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
</svg>

chevron-up svg:
<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="size-6">
<path stroke-linecap="round" stroke-linejoin="round" d="m4.5 15.75 7.5-7.5 7.5 7.5" />
</svg>

## REVISIONS:

### Risk: Enum Low Avg High (Low: --postive color, Avg: --accent-green color, High: --negative color)

    New Risk Enum should be 1 | 2 | 3 | 4 | 5
    This way the risk can be stored in the db more easily and the actual implementation of displaying the risk in the UI can be handled entirely client side (and be modified in the future if necessary)
    Each Value should correlate with with the following descriptions and colors
      1. Low - #10E585
      2. Below Average - #40CB90
      3. Average - #9A9AA5
      4. Above Average - #C36357
      5. High - #D64933
    In the Fund Card in the UI, instead of just showing the Text string, I would like to add a small css-only segemented colored bar. all filled colors should be the same depending on the risk value. so an above-average risk would have 4/5 segments colored in, with a color value that is halfway between the negative color and the muted color.

### Admin statistics

    would it be possbile to calculate a estimated/expected volatilty score for each fund, exposed only in the admin page for managing funds?
    would it also be possible to calculate as estimated yield over over vacious breakpoints, say 7 days and 30 days, based on the gain and loss multipliers?
