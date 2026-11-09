// Privacy policy, terms of service and data deletion instructions. Meta, Google, TikTok, Snapchat
// and the other sign-in networks require public URLs for these before an app can go live. They
// describe what the portal's code actually does; keep them in step when that changes.

export const LEGAL_UPDATED = 'November 9, 2026';
export const OPERATOR = 'Tenacié LLC';
export const CONTACT = 'support@rookiegamers.com';

const page = (path, name, title, description, h1, body) => ({
  title, description, h1, body,
  jsonld: [{
    '@context': 'https://schema.org', '@type': 'WebPage', '@id': `https://rookiegamers.com${path}#page`,
    url: `https://rookiegamers.com${path}`, name, description, dateModified: '2026-11-09',
    publisher: { '@type': 'Organization', name: 'RookieGamers', parentOrganization: { '@type': 'Organization', name: OPERATOR } },
  }],
});

export const PRIVACY_PAGE = page('/privacy', 'RookieGamers Privacy Policy',
  'RookieGamers Privacy Policy · What we collect and why',
  'What RookieGamers collects when you play, sign in or publish a game, why we collect it, who we share it with and how to delete it.',
  'Privacy Policy',
  `Last updated: ${LEGAL_UPDATED}

RookieGamers (rookiegamers.com) is run by ${OPERATOR} ("we", "us"). This policy covers the RookieGamers website, the RookieGamers account you use to sign in to games, and the RookieGamers SDK that games use to talk to the portal.

## What we collect
- **Your account.** A player ID, the display name you choose, your avatar color, your level and XP, any titles you earn, your gem balance, the profile icons you own and when you joined.
- **Sign-in details.** If you sign in with email, your email address. If you sign in with or link a social network (for example Google, YouTube, Facebook, Instagram, Threads, TikTok, X, Reddit, Snapchat, LinkedIn, Discord, Twitch, Kick, GitHub, Steam, Telegram or Bluesky), we store that network's ID for you and the basic profile it shares: your name, username and profile picture, and your email when the network provides a verified one. We never get your password for those networks, and we don't post anything on them for you.
- **Gameplay.** Which games you play, for how long, your scores, leaderboard and Hall of Fame places, the game that sent you to another game, and the save data a game stores for you (cloud saves).
- **Sharing and invites.** Share links you create, and who joined through your invite link, so we can award gems.
- **Ads and store.** When you watch an ad to unlock something, a record of that view. When you buy something, the order and what it unlocked. Payments are handled by Stripe, and we never see or store your full card number.
- **Wallets (18+, optional, not live yet).** If you later connect a crypto wallet, its public address and network. Wallets are never needed to play.
- **Developers.** If you publish games: your developer name, your games and uploads, hashed API keys, ad and earnings records, and the payout account details that Stripe Connect shares with us.
- **Technical data.** Your IP address and browser details are processed by Cloudflare to serve and protect the site. We don't use them to build a profile of you.

## Why we use it
To run your account and sign you in, keep scores and the Hall of Fame, award gems, recommend the next game to play, deliver purchases and ad unlocks, pay developers, stop cheating and abuse, and keep the service working. We don't sell your personal information.

## Who we share it with
- **Games you play.** When you play a game, it gets a signed token with your player ID and display name, and can read your public profile, so it can show your name and save your scores. It doesn't get your email or your linked networks.
- **Other players.** Your display name, avatar, level, titles, scores and Hall of Fame places are public.
- **Service providers** that run parts of the service for us: Cloudflare (hosting, database and storage), Resend (sign-in emails), Stripe (payments and developer payouts) and, when ads are on, the ad networks that serve them. They only use the data to provide their service.
- **The network you signed in with**, which knows you used it to sign in to RookieGamers.
- **The law.** If we're required to by law, or to protect players and the service.

## Cookies
We use a sign-in cookie to keep you signed in, short-lived cookies while a sign-in is in progress, and a cookie that remembers which friend's invite link brought you here (for 30 days). Your sound setting is saved in your browser. When ads are on, ad networks may set their own cookies.

## Children
RookieGamers accounts are for people 13 and up. We don't knowingly collect personal information from children under 13. If you believe a child under 13 has made an account, email ${CONTACT} and we'll delete it. Crypto features are 18+ only.

## How long we keep it
We keep your account while it's active. When you delete it, your profile, linked sign-ins, sessions, scores, gems, saves, wallets and play history are removed straight away. Purchase and payout records are kept, no longer linked to you, as long as tax and accounting law requires. Hall of Fame entries stay as history, shown as "Deleted player".

## Your choices and rights
You can change your display name on your profile, sign out, and [delete your account](/data-deletion) at any time. Depending on where you live, you may have the right to see, correct, export or delete your data, or to object to how we use it. Email ${CONTACT} and we'll answer within 30 days.

## Security
Data travels over HTTPS. API keys and sign-in tokens are stored only as hashes, and game tokens are signed and short-lived. No system is perfectly secure, so please tell us at ${CONTACT} if you find a problem.

## Changes
If we change this policy, we'll update the date at the top. If the change is significant, we'll also tell you on the site.

## Contact
${OPERATOR}, RookieGamers. Email: ${CONTACT}. See also our [Terms of Service](/terms).`);

export const TERMS_PAGE = page('/terms', 'RookieGamers Terms of Service',
  'RookieGamers Terms of Service',
  'The rules for playing on RookieGamers, using a RookieGamers account, gems and purchases, and publishing games.',
  'Terms of Service',
  `Last updated: ${LEGAL_UPDATED}

These terms are an agreement between you and ${OPERATOR}, which runs RookieGamers (rookiegamers.com). By using RookieGamers you agree to them and to our [Privacy Policy](/privacy).

## Your account
You must be 13 or older to make a RookieGamers account, and 18 or older to use any crypto feature. Keep your sign-in methods secure. You're responsible for what happens on your account. One person per account, and no selling or sharing accounts.

## Playing fair
Don't cheat, exploit bugs, submit fake scores, use bots, farm gems or referrals with fake accounts, harass other players, or pick a display name that is hateful, sexual or pretends to be someone else. We may remove scores, gems, titles or accounts that break these rules.

## Gems and virtual items
Gems are rewards for linking networks and inviting friends. Gems and items you unlock in games have no cash value, can't be sold or transferred, and never turn into coin or cash. Purchases unlock the item described in the store for that game. Unless the law says otherwise, purchases are final, but email ${CONTACT} if something you paid for doesn't arrive.

## Ads
Some games show ads, and some items can be unlocked by watching them. Don't fake ad views or block them in a way that breaks a game.

## Crypto (18+, optional)
The RookieGamers coin is optional and only gives a discount in stores that accept it. It isn't an investment, and nothing on RookieGamers is gambling. Its value can go up or down, or to zero. You're responsible for your wallet and its keys.

## Developers
If you publish a game, you confirm that you own it or have the rights to publish it, and that it follows these terms and the [SDK rules](/docs): the RookieGamers account is the game's only sign-in, and the game doesn't include outside ad code or malware. You keep ownership of your game. You give us permission to host it, show it, make clips and previews of it, and promote it on RookieGamers. Ads, store sales and payouts follow the ad and store terms you accept on the [Publish](/dev) page. We may review, hide or remove any game.

## Content
Games are made by their developers, not by us. Report anything illegal or harmful to ${CONTACT}.

## Ending your account
You can [delete your account](/data-deletion) at any time. We may suspend or close accounts that break these terms.

## No warranty
RookieGamers is provided "as is". Games may change, break or be removed. To the extent the law allows, we aren't liable for indirect or lost-profit damages, and our total liability is limited to what you paid us in the 12 months before the claim.

## Changes
We may update these terms. If we do, we'll change the date at the top, and continuing to use RookieGamers means you accept the new terms.

## Contact
${OPERATOR}, RookieGamers. Email: ${CONTACT}.`);

export const DELETION_PAGE = page('/data-deletion', 'Delete your RookieGamers data',
  'Delete your RookieGamers account and data',
  'How to delete your RookieGamers account and the data linked to it, including data from Facebook and other sign-in networks.',
  'Delete your account and data',
  `You can delete your RookieGamers account and its data at any time.

## Delete it yourself
1. [Sign in](/signin) to RookieGamers.
2. Open your profile (your name in the top bar).
3. At the bottom, open **Delete my account**, type DELETE and confirm.

This removes your profile, every linked sign-in (Facebook, Google and the rest), your sessions, scores, gems, saves, wallets and play history straight away. Purchase and payout records are kept for tax law, no longer linked to you. Hall of Fame entries stay as history, shown as "Deleted player". It can't be undone.

If you publish games, remove or transfer your games first, or email us and we'll help.

## Remove just Facebook
In Facebook, go to **Settings & privacy → Settings → Apps and websites**, find RookieGamers and remove it. We then delete the Facebook link and the profile details Facebook shared with us. Your RookieGamers account stays, along with any other sign-ins you linked. The other networks have similar app settings, and removing RookieGamers there stops it signing you in.

## Ask us to do it
Can't sign in? Email ${CONTACT} from the email on your account, or tell us which network you used to sign in, and we'll delete your data within 30 days.

See the [Privacy Policy](/privacy) for what we collect.`);

export const LEGAL_PAGES = { '/privacy': PRIVACY_PAGE, '/terms': TERMS_PAGE, '/data-deletion': DELETION_PAGE };
