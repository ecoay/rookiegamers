/**
 * The published scenario catalog. Each one is a title, a short setup, exactly
 * five roles, and two punchline variants per role (so the same disaster can
 * play twice without repeating itself). Bump `version` when wording changes;
 * a saved party records the version it was drawn from.
 */
export type Role = { name: string; lines: [string, string] };

export type Scene = {
  /** Background colours for the procedural backdrop until real art lands. */
  sky: string;
  ground: string;
  accent: string;
  /** Which simple backdrop motif the card draws. */
  motif: "cave" | "city" | "stars" | "vault" | "motel" | "sea" | "hall" | "bunker" | "clock" | "retreat";
};

export type Scenario = {
  id: string;
  version: number;
  title: string;
  setup: string;
  creator: string;
  scene: Scene;
  roles: [Role, Role, Role, Role, Role];
};

const r = (name: string, a: string, b: string): Role => ({ name, lines: [a, b] });

export const SCENARIOS: Scenario[] = [
  {
    id: "dragon",
    version: 1,
    title: "The Dragon's Cavern",
    setup: `Your party reaches the treasure chamber. The dragon wakes up. Somebody says, "Let me talk to him." You now have two problems.`,
    creator: "ecoay",
    scene: { sky: "#2a1a14", ground: "#4a2c1a", accent: "#e0782a", motif: "cave" },
    roles: [
      r("The Negotiator", "Offered the dragon exposure instead of treasure.", `Opened with "So what do you do?"`),
      r("The Human Shield", `Took "draw its attention" personally.`, "Volunteered. Nobody stopped them. Nobody tried."),
      r("The Loot Goblin", "Has already pocketed a dragon egg.", "Filling pockets while the room is on fire."),
      r("The Healer With Essential Oils", "Applied lavender to a third-degree burn.", "Says the dragon is just holding trauma."),
      r("The Reason It Woke Up", "Sneezed. In a cave. Built for echoes.", "Wanted a selfie with flash on."),
    ],
  },
  {
    id: "zombies",
    version: 1,
    title: "The Zombie Apocalypse",
    setup: "The dead have risen. Your group has one vehicle, half a tank, and somebody insisting this is all being exaggerated. He's been bitten twice.",
    creator: "ecoay",
    scene: { sky: "#39402a", ground: "#22261a", accent: "#9fbf3b", motif: "city" },
    roles: [
      r("The Driver", "Stopped for gas with a horde on the hood.", `Won't run over a zombie. "It's someone's dad."`),
      r("The Supply Hoarder", "Forty rolls of toilet paper. Zero water.", "Charges the group for their own canned beans."),
      r("The Bite Concealer", `"It's a hickey." It is not a hickey.`, "Wearing a turtleneck in July. Sweating. Gray."),
      r("The Rooftop Philosopher", "Asking if we're the real monsters. During the siege.", "Wrote a manifesto on the last piece of paper."),
      r("The Loudest Snack", "Opened Doritos at the worst possible moment.", "Chews loud enough to ring the dinner bell."),
    ],
  },
  {
    id: "aliens",
    version: 1,
    title: "The Alien Abduction",
    setup: "Aliens abduct your group to study intelligent life. Twenty minutes later, they start checking the tractor beam for a gas leak.",
    creator: "ecoay",
    scene: { sky: "#141a33", ground: "#262d4d", accent: "#62e0c4", motif: "stars" },
    roles: [
      r("The Human Ambassador", "Represented Earth with a fart joke. It landed.", "Tried to give the aliens a timeshare pitch."),
      r("The Probe Volunteer", "Raised their hand before the question finished.", "Asked for a loyalty card."),
      r("The UFO Thief", "Hotwired the mothership. Can't drive stick.", "Already listed the tractor beam on Marketplace."),
      r("The One Asking for Wi-Fi", "Interstellar travel, and they want the password.", "Left a one-star review of the spaceship."),
      r("The Reason They Lock Earth's Doors", `Aliens now list Earth as "do not engage."`, "The galaxy has a restraining order with their name on it."),
    ],
  },
  {
    id: "heist",
    version: 1,
    title: "The Bank Heist",
    setup: "You've spent six months planning the perfect robbery. Somebody walks in and uses their debit card at the ATM first.",
    creator: "ecoay",
    scene: { sky: "#2b2f33", ground: "#1b1e21", accent: "#d9b23a", motif: "vault" },
    roles: [
      r("The Mastermind", `The plan was 40 pages. Page one was "get in."`, "Brought a whiteboard. To the robbery."),
      r("The Getaway Driver", "Parked in the bank's tow-away zone. Got towed.", "Signaled every turn of the chase."),
      r("The Safecracker", "Got the safe open. Locked themselves in it.", "Tried 1-2-3-4. It worked. Nobody's happy."),
      r("The Hostage Who Joined In", "Asked for a cut by minute four.", `Now sharing their banking app "for efficiency."`),
      r("The Loyalty Rewards Member", "Earned double points on the stolen money.", "Asked the teller to stamp their punch card mid-heist."),
    ],
  },
  {
    id: "motel",
    version: 1,
    title: "The Haunted Motel",
    setup: "The room is $39 a night. The walls bleed. Checkout is at eleven, and the owner says the screaming counts as a second guest.",
    creator: "ecoay",
    scene: { sky: "#1f1420", ground: "#3a2430", accent: "#ff4f8b", motif: "motel" },
    roles: [
      r("The Ghost Negotiator", "Got the ghost to agree to quiet hours. Ghost lied.", "Talked the ghost into splitting the room cost."),
      r("The Exorcist From Temu", "Holy water arrived. It's Sprite.", "The crucifix is a USB stick shaped like a cross."),
      r("The One Filming", "Shot the whole thing vertical. Monetized the demon.", `"Hold on, do that again, I wasn't recording."`),
      r("The One Already Possessed", "Honestly seems happier.", "Nobody noticed for six hours. Same energy."),
      r("The One Arguing About the Deposit", "The walls bleed. They want the $20 back.", `Took photos of the blood "for the dispute."`),
    ],
  },
  {
    id: "lifeboat",
    version: 1,
    title: "The Last Lifeboat",
    setup: "The ship is sinking. Five seats, five of you, and the cruise director trying to climb in. One friend is reserving a seat for their personal brand.",
    creator: "ecoay",
    scene: { sky: "#1c2e3d", ground: "#123247", accent: "#f2f2f2", motif: "sea" },
    roles: [
      r("The Captain Now", "Promoted themselves. Nobody remembers voting.", "Wearing the real captain's hat. Unclear how."),
      r("The Paddle Hoarder", "Has both paddles. Sitting on them.", "Rents the paddle out by the minute."),
      r("The Motivational Speaker", `"Every wave is an opportunity." Capsized.`, "Started a gratitude circle in the open ocean."),
      r("The Suspiciously Dry One", "Not a drop on them. No one asks.", "Was in the lifeboat before the iceberg."),
      r("The Difficult Decision", "Let the cruise director in. He brought a kazoo.", "Voted out the cruise director. Kept his lanyard."),
    ],
  },
  {
    id: "banquet",
    version: 1,
    title: "The Royal Banquet",
    setup: "Your party has been invited to dine with the king. Someone insults the bloodline before the soup arrives. The executioner pulls up a chair.",
    creator: "ecoay",
    scene: { sky: "#3a1418", ground: "#5a2a1c", accent: "#e8c15a", motif: "hall" },
    roles: [
      r("The Fake Noble", `Introduced as "Duke of the Group Chat."`, "Their family crest is the Applebee's logo."),
      r("The Food Tester", "Survived the poison. Asked for seconds.", `Ate the whole course "to be thorough."`),
      r("The Silverware Thief", "Spoons in every pocket. Clanks when they bow.", "Took the king's goblet. Still drinking from it."),
      r("The Accidental Revolutionary", `Said "this soup sucks." The peasants heard "rise."`, "Now running the kingdom. Doesn't want to."),
      r("The One Still Asking About Dessert", "The castle is burning. Is there cake?", "Asked the executioner if he does custard."),
    ],
  },
  {
    id: "bunker",
    version: 1,
    title: "The End-of-the-World Bunker",
    setup: "You seal the bunker for ten years. You have food, water, power, and a friend who says this is a great opportunity to start a podcast.",
    creator: "ecoay",
    scene: { sky: "#2c2b26", ground: "#3d3a30", accent: "#f0c419", motif: "bunker" },
    roles: [
      r("The Ration Accountant", "Made a spreadsheet. The spreadsheet is the enemy.", "Charges interest on borrowed crackers."),
      r("The Door Inspector", `Checks the seal hourly. Opened it once. "To test."`, "Lets anyone in who knocks politely. Including that."),
      r("The Underground Podcaster", "Episode 312. Zero listeners. Plenty of ads.", "Asked the apocalypse to sponsor episode one."),
      r("The Secret Snack Dealer", "Runs a gummy bear black market from the vent.", "Accepts payment in socks."),
      r("The One Voting to Go Back Outside", "It's been four hours.", "Packed a bag. Sunscreen. Optimism."),
    ],
  },
  {
    id: "timemachine",
    version: 1,
    title: "The Time Machine",
    setup: "Your group travels back to stop one historical disaster. Somebody immediately invents a worse one and asks if the domain is available.",
    creator: "ecoay",
    scene: { sky: "#1d2433", ground: "#3a2f22", accent: "#4fc3f7", motif: "clock" },
    roles: [
      r("The Timeline Keeper", "Kept the notes. In the future. Which is gone.", `Yells "don't touch anything." Touches everything.`),
      r("The Accidental Dictator", "Gave a speech in 1803. Has a statue now.", "Won an empire by explaining Wi-Fi."),
      r("The Future Spoiler", "Told Napoleon how it ends. Napoleon took notes.", "Spoiled every movie for the next 200 years."),
      r("The One Selling Fire", "Cavemen had fire. They're pitching it as SaaS.", "Fire subscription: $9.99 a month, cancel anytime."),
      r("The Reason Tuesday No Longer Exists", "Stepped on a bug. Lost a weekday.", "We don't talk about Tuesday. They know why."),
    ],
  },
  {
    id: "cult",
    version: 1,
    title: "The Cult Retreat",
    setup: "Your friends book a wellness weekend. By Saturday, everyone is wearing linen and your car belongs to a man named Father Horizon.",
    creator: "ecoay",
    scene: { sky: "#e8d9b8", ground: "#8a9a5b", accent: "#b03a2e", motif: "retreat" },
    roles: [
      r("The Recruiter", "Brought five more people. One of them is you.", "Got a commission. Paid in more linen."),
      r("The Skeptic Who Paid Extra", `"This is clearly a scam." Bought the VIP robe.`, "Rolled eyes so hard they reached enlightenment."),
      r("The Robe Influencer", "Started a robe haul channel. Father Horizon is jealous.", "Has a discount code for the compound."),
      r("The Escape Planner", "Planned an escape. Stayed for the brunch.", "Dug a tunnel. It goes to the gift shop."),
      r("The New Regional Director", "Running the Midwest chapter by Sunday.", "Father Horizon reports to them now."),
    ],
  },
];

export function scenarioById(id: string): Scenario | undefined {
  return SCENARIOS.find((s) => s.id === id);
}
