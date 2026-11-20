import { parseTiming, occurDate } from "./calendar.js";
import { esc } from "./http.js";

/**
 * Public tradition ideas a family can borrow and make their own.
 * No photos, counts, rankings, or names of real families.
 *
 * Each idea: name, a one-line how-to (practice), a suggested date (timing),
 * and tags for the filters on /ideas. Season is worked out from the month
 * (Northern Hemisphere); add "any" to `also` for ideas that fit year-round.
 *
 * New ideas shared through the "Share an idea" form land in the D1
 * idea_submissions queue first. See README "Shared ideas" for how a reviewed
 * one gets added here.
 */

export const SEASONS = [
  ["winter", "Winter"], ["spring", "Spring"], ["summer", "Summer"], ["fall", "Fall"], ["any", "Any time"],
];
export const AGES = [
  ["little", "Little kids"], ["big", "Big kids"], ["teens", "Teens"],
  ["adults", "Adults & couples"], ["grand", "Grandparents"], ["family", "Whole family"],
];
export const TYPES = [
  ["breakfast", "Breakfast"], ["lunch", "Lunch"], ["dinner", "Dinner"], ["restaurants", "Restaurants"],
  ["movies", "Movies"], ["games", "Games"], ["sports", "Sports games"], ["music", "Music"],
  ["outdoors", "Outdoors"], ["crafts", "Crafts"], ["books", "Books & stories"], ["faith", "Faith"],
  ["giving", "Giving"], ["spooky", "Spooky season"],
];
export const PLACES = [
  ["snowy", "Snowy"], ["warm", "Warm"], ["city", "City"], ["country", "Country"], ["beach", "Beach"], ["anywhere", "Anywhere"],
];
export const FILTERS = [
  ["season", "Season", SEASONS],
  ["age", "Age", AGES],
  ["type", "Type", TYPES],
  ["place", "Place", PLACES],
];

const MONTH_SEASON = ["winter", "winter", "spring", "spring", "spring", "summer", "summer", "summer", "fall", "fall", "fall", "winter"];

function slugify(name) {
  return name.toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/** idea(name, practice, timing, "ages", "types", "places", "any"?) */
function idea(name, practice, timing, ages, types, places = "anywhere", also = "", slug = "") {
  const rule = parseTiming(timing);
  const seasons = rule ? [MONTH_SEASON[rule.month - 1]] : [];
  if (also.includes("any")) seasons.push("any");
  return {
    slug: slug || slugify(name),
    name,
    practice,
    timing,
    seasons,
    ages: ages.split(" "),
    types: types.split(" "),
    places: places.split(" "),
  };
}

export const IDEAS = [
  // The originals.
  idea("Grinch Movie Night", "Everyone brings something green. No green, no screen.", "Second Saturday in December", "little big teens family", "movies", "anywhere", "", "grinch-movie-night"),
  idea("First-snow pancakes", "Make pancakes the first time it snows, or on this Saturday if the snow is late.", "Second Saturday in January", "little big family", "breakfast", "snowy", "", "first-snow-pancakes"),
  idea("Flashlight walk", "After dark, walk around the block with flashlights. Cocoa when you get home.", "First Friday in February", "little big family", "outdoors", "anywhere", "", "flashlight-walk"),
  idea("Backwards dinner", "Dessert first, then dinner. Pajamas are welcome.", "Second Friday in March", "little big family", "dinner", "anywhere", "", "backwards-dinner"),
  idea("Kids-cook night", "The kids make dinner. Grown-ups set the table and wash up.", "Second Sunday in April", "big teens family", "dinner", "anywhere", "", "kids-cook-night"),
  idea("Porch breakfast", "Eat breakfast outside, even if it's a little chilly.", "First Saturday in May", "family grand", "breakfast outdoors", "anywhere", "", "porch-breakfast"),
  idea("Half-birthday cake", "A little cake, halfway to a birthday. Candles are optional.", "Second Saturday in June", "little big", "dinner", "anywhere", "any", "half-birthday-cake"),
  idea("Porch campout", "Sleep on the porch or in the yard. Flashlights and stories.", "Second Saturday in July", "little big family", "outdoors", "country anywhere", "", "porch-campout"),
  idea("Stargaze night", "Lie on a blanket and look at the stars.", "Second Friday in August", "family adults", "outdoors", "country", "", "stargaze-night"),
  idea("Library Saturday", "Everyone picks a book. Read a little together after.", "Third Saturday in September", "little big family grand", "books", "anywhere", "any", "library-saturday"),
  idea("Leaf-pile day", "Rake a big pile and jump in it.", "Third Saturday in October", "little big family", "outdoors", "country anywhere", "", "leaf-pile-day"),

  // Spooky season: all through October, never on the 31st itself.
  idea("Costume-planning night", "Sketch costume ideas and dig through the closet for pieces.", "First Friday in October", "little big teens", "crafts spooky"),
  idea("Pumpkin patch Saturday", "Everyone picks a pumpkin. Carve or paint them that night.", "First Saturday in October", "little big family", "outdoors spooky", "country"),
  idea("Not-too-scary movie night", "One gentle spooky movie, lights low, popcorn in a big bowl.", "Second Friday in October", "big teens family", "movies spooky"),
  idea("Cardboard haunted house", "Build a haunted house from boxes. Everyone makes one room.", "Second Sunday in October", "little big", "crafts spooky"),
  idea("Ghost-story campfire", "Tell silly ghost stories around a fire or a flashlight.", "Third Friday in October", "big teens family", "outdoors spooky books", "country anywhere"),
  idea("Monster pancakes", "Green pancakes with fruit eyes. Give each monster a name.", "Third Sunday in October", "little big", "breakfast spooky"),
  idea("Hayride and corn maze", "Find a hayride or corn maze. Stick together in the maze.", "Third Saturday in October", "big teens family", "outdoors spooky", "country"),
  idea("Witch's stew supper", "Any soup, called witch's stew, eaten by candlelight.", "Fourth Friday in October", "little big family", "dinner spooky"),
  idea("Name-the-scarecrow day", "Stuff old clothes with leaves. Give your scarecrow a name.", "Fourth Saturday in October", "little big family", "crafts outdoors spooky", "country anywhere"),
  idea("Glow-stick monster mash", "Everyone adds one spooky song. Dance in the dark with glow sticks.", "Fourth Sunday in October", "little big teens", "music spooky"),

  // Faith and gratitude: quiet family practices, away from the big holy days.
  idea("Gratitude jar", "All week, drop in thank-you notes. Read them together on Sunday.", "First Sunday in March", "family grand", "faith giving", "anywhere", "any"),
  idea("Grace in our own words", "Before dinner, each person says a thank-you in their own words or tradition.", "Fourth Tuesday in January", "family grand", "faith dinner", "anywhere", "any"),
  idea("Verse of the year", "Pick one Bible verse to learn by heart together this year.", "First Sunday in February", "big teens family grand", "faith books"),
  idea("Bible story picnic", "Read a favorite Bible story aloud on a blanket, then eat lunch.", "Second Sunday in June", "little big family", "faith lunch outdoors"),
  idea("Hymn sing Sunday", "Everyone picks a favorite hymn or worship song. Sing it together.", "Third Sunday in September", "family grand", "faith music"),
  idea("Shabbat candles and one good thing", "Light candles, share challah, and each say one good thing from the week.", "First Friday in March", "family grand", "faith dinner"),
  idea("Tzedakah box day", "Decorate a coin box together and choose who it will help.", "Third Sunday in February", "little big family", "faith crafts giving"),
  idea("Havdalah under the stars", "On Saturday night, look for three stars, light a braided candle, wish for a good week.", "Fourth Saturday in August", "family", "faith outdoors"),
  idea("Family du'a and lunch", "After Friday prayers, gather for a family du'a and a shared lunch.", "First Friday in June", "family grand", "faith lunch"),
  idea("Sadaqah Saturday", "Pick a cause together and give a little, as a family.", "Fourth Saturday in February", "big teens family", "faith giving"),
  idea("Diya and bhajan evening", "Light a small diya, sing a favorite bhajan, and share a family story.", "Third Friday in August", "family grand", "faith music"),
  idea("Seva morning", "Spend a morning serving together, like a food pantry or a temple kitchen.", "Third Saturday in March", "big teens family", "faith giving"),
  idea("Mindful tea morning", "Sit quietly for five minutes, then share tea and one kind wish for the week.", "Second Sunday in January", "teens adults grand", "faith breakfast"),
  idea("Kindness walk", "Walk slowly and silently wish well to everyone you pass.", "Third Sunday in July", "family adults", "faith outdoors"),
  idea("Painted prayer rocks", "Paint rocks with a word you're thankful for and set them in the garden.", "Second Saturday in April", "little big family", "faith crafts outdoors"),
  idea("Neighborhood blessing walk", "Walk your streets and say a quiet blessing or good wish for each one.", "Fourth Sunday in May", "family grand", "faith outdoors"),
  idea("How grandma kept the faith", "Grandparents share how they practiced their faith growing up.", "First Sunday in November", "grand family", "faith books"),

  // Grown-ups and couples.
  idea("Same-booth date night", "Go back to the same restaurant. Sit in the same booth if you can.", "Second Thursday in March", "adults", "restaurants dinner", "city anywhere"),
  idea("Anniversary letters", "Write each other a letter. Read last year's first, over dinner.", "Third Friday in February", "adults", "dinner books"),
  idea("Sunrise coffee date", "Wake early, take coffee somewhere with a view, watch the sun come up.", "First Saturday in August", "adults", "breakfast outdoors", "beach anywhere"),
  idea("Couples' cook-along", "Each cook one dish from a cuisine you've never tried. Swap plates.", "Fourth Saturday in January", "adults", "dinner"),
  idea("Same-friends potluck", "Invite the same friends every year. Everyone brings their signature dish.", "Third Saturday in May", "adults", "dinner"),
  idea("Kitchen slow dance", "Play your song and dance while dinner cooks.", "Second Friday in November", "adults", "music", "anywhere", "any"),
  idea("Book club of two", "Read the same book this month. Talk about it over dessert out.", "Last Sunday in January", "adults", "books restaurants"),
  idea("Grown-ups' game night", "Cards or a board game after the kids are asleep.", "Second Friday in January", "adults", "games", "anywhere", "any"),
  idea("Last year in ten pictures", "Each pick ten favorite moments from last year and tell the story behind them.", "Second Sunday in January", "adults family", "crafts"),
  idea("Sunset walk, phones away", "Walk the same path at sunset. Phones stay home.", "Third Wednesday in June", "adults grand", "outdoors"),

  // Grandparents.
  idea("Grandparent recipe day", "Cook a family recipe with a grandparent and write it down together.", "Second Saturday in November", "grand big teens", "dinner"),
  idea("When you were little", "Ask a grandparent one question about their childhood. Write down the answer.", "First Sunday in April", "grand little big", "books"),
  idea("Old-songs sing-along", "Grandparents teach the songs they grew up with.", "Fourth Sunday in March", "grand little big", "music"),
  idea("Fishing with a grandparent", "A morning at the same pond or pier with a grandparent.", "Third Saturday in June", "grand big", "outdoors", "country beach"),
  idea("Grandparents' card game", "Learn the card game your grandparents played as kids.", "Third Sunday in January", "grand big teens", "games", "anywhere", "any"),
  idea("Letters to grandparents", "Kids mail a handwritten letter and a drawing.", "Second Tuesday in October", "little big grand", "crafts giving"),
  idea("Plant one thing together", "Plant one flower or vegetable with a grandparent. Check on it every visit.", "Fourth Saturday in April", "grand little", "outdoors", "country anywhere"),
  idea("Grandparent movie pick", "Grandparents pick a movie from their childhood. Everyone watches.", "Second Sunday in December", "grand family", "movies"),
  idea("Lunch out with a grandparent", "Take a grandparent to their favorite lunch spot.", "Third Wednesday in September", "grand teens adults", "lunch restaurants"),

  // Breakfast.
  idea("Waffle bar Saturday", "Set out toppings. Everyone builds their own waffle.", "First Saturday in March", "little big family", "breakfast"),
  idea("Muffins for a neighbor", "Bake muffins and leave a few on a neighbor's porch.", "Second Saturday in September", "little big family", "breakfast giving"),
  idea("Same diner, same order", "Go to the same diner every year and order the usual.", "Fourth Sunday in February", "family grand", "breakfast restaurants", "city country"),
  idea("Pajama donut run", "Drive to get donuts while still in pajamas.", "Third Saturday in January", "little big", "breakfast"),
  idea("Silly smoothie morning", "Everyone invents a smoothie and gives it a silly name.", "Fourth Saturday in June", "little big teens", "breakfast", "warm anywhere"),
  idea("Beach sunrise breakfast", "Pack breakfast sandwiches and eat on the sand at sunrise.", "Second Sunday in August", "family", "breakfast outdoors", "beach"),
  idea("Snow-day cinnamon rolls", "Bake cinnamon rolls the first morning school is called off.", "First Saturday in February", "little big family", "breakfast", "snowy"),
  idea("Breakfast in bed day", "Kids bring a grown-up breakfast in bed. Crumbs allowed.", "Second Sunday in November", "little big", "breakfast giving"),

  // Lunch.
  idea("Living-room picnic", "Too cold out? Spread a blanket on the floor and picnic there.", "Third Saturday in February", "little big", "lunch", "snowy anywhere"),
  idea("Lunchbox swap", "Pack each other's lunch. Add a note.", "Fourth Monday in August", "big teens family", "lunch"),
  idea("Food truck Saturday", "Try a food truck none of you have tried.", "Second Saturday in May", "teens family", "lunch restaurants", "city"),
  idea("Same park, same tree", "Picnic under the same tree every year. Sandwiches and lemonade.", "First Sunday in June", "family grand", "lunch outdoors"),
  idea("Sled and grilled cheese", "Sled all morning, then grilled cheese and tomato soup.", "Third Sunday in February", "little big family", "lunch outdoors", "snowy"),
  idea("Farmers market lunch", "Buy lunch at the market and eat it in the park.", "Third Saturday in July", "family", "lunch outdoors", "city country"),

  // Dinner.
  idea("Around-the-world dinner", "Spin a globe, point, and cook a dish from there.", "Fourth Friday in March", "big teens family", "dinner"),
  idea("Breakfast for dinner", "Pancakes and eggs at dinnertime.", "First Tuesday in February", "little big family", "dinner breakfast", "anywhere", "any"),
  idea("Build-your-own taco night", "Set out fillings. Everyone builds their own.", "Third Tuesday in May", "little big teens family", "dinner", "anywhere", "any"),
  idea("First grill-out", "Fire up the grill on the first warm evening of the year.", "Fourth Saturday in May", "family", "dinner outdoors", "warm anywhere"),
  idea("Fancy dinner at home", "Dress up, cloth napkins, and a menu the kids write.", "Third Saturday in November", "little big family", "dinner crafts"),
  idea("Make-your-own pizza night", "Everyone tops their own little pizza.", "First Friday in April", "little big teens", "dinner", "anywhere", "any"),
  idea("Soup swap", "Make a big pot and trade jars with friends or neighbors.", "Fourth Sunday in November", "adults family", "dinner giving", "snowy anywhere"),
  idea("Seafood boil on newspaper", "Cook a seafood boil and eat it on newspaper with your hands.", "Second Saturday in August", "family", "dinner", "beach warm"),
  idea("Secret-ingredient chili", "Everyone adds one secret ingredient to the pot. Guess them all.", "Fourth Sunday in January", "big teens family", "dinner", "snowy anywhere"),

  // Restaurants.
  idea("New-cuisine night out", "Eat somewhere serving food none of you have tried.", "Second Friday in September", "big teens family adults", "restaurants dinner", "city"),
  idea("Last-day-of-school dinner", "Celebrate the end of the school year at a favorite spot.", "Third Friday in June", "big teens family", "restaurants dinner"),
  idea("First cone of the year", "Visit the ice cream shop the week it opens for spring.", "Fourth Saturday in March", "little big family", "restaurants", "anywhere"),
  idea("Our pizza place", "Same pizza place every year. Order the usual.", "First Friday in November", "family", "restaurants dinner", "anywhere", "any"),
  idea("Dim sum Sunday", "Share dim sum or small plates. Everyone picks one dish.", "Second Sunday in March", "family grand", "restaurants lunch", "city"),
  idea("Road-trip diner stop", "Stop at the same roadside diner on a yearly drive.", "Fourth Saturday in July", "family", "restaurants lunch", "country"),
  idea("Parent and teen breakfast out", "A one-on-one breakfast out, just the two of you.", "Second Saturday in October", "teens adults", "breakfast restaurants"),

  // Movies.
  idea("Backyard movie night", "Hang a sheet, set up a projector or a laptop, and watch outside.", "Fourth Friday in July", "little big teens family", "movies outdoors", "warm anywhere"),
  idea("Our movie, every year", "Rewatch the same family movie every year. Quote along.", "Fourth Friday in January", "family", "movies"),
  idea("Drive-in night", "Go to a drive-in, or make cardboard cars in the living room.", "Third Saturday in August", "little big family", "movies", "country anywhere"),
  idea("Dinner from the movie", "Cook a food that shows up in the movie you watch.", "Third Friday in January", "big teens family", "movies dinner"),
  idea("Teen picks the movie", "A teen picks the movie. No grown-up vetoes, within reason.", "Fourth Friday in September", "teens", "movies"),
  idea("Snowed-in double feature", "Two movies, a blanket fort, and cocoa.", "Fourth Saturday in January", "little big family", "movies", "snowy"),

  // Games.
  idea("Board game marathon", "Pull out every board game. Play until bedtime.", "Third Saturday in December", "big teens family grand", "games"),
  idea("Backyard games day", "Sack races and a water-balloon toss. Homemade medals for everyone.", "Third Saturday in August", "little big family", "games outdoors", "warm anywhere"),
  idea("Puzzle weekend", "Start a big puzzle on Friday. Finish it by Sunday.", "First Friday in December", "family grand", "games"),
  idea("Treasure hunt", "Hide clues around the house. The last one leads to a treat.", "Second Saturday in March", "little big", "games"),
  idea("Snow-fort day", "Build a snow fort, then a gentle snowball battle.", "Second Sunday in January", "little big teens", "games outdoors", "snowy"),
  idea("Family trivia night", "Everyone writes questions about the family.", "Second Friday in April", "big teens adults grand", "games", "anywhere", "any"),
  idea("Kids teach a video game", "Kids teach the grown-ups their favorite game.", "Fourth Friday in February", "big teens adults", "games"),
  idea("Beach games day", "Frisbee, sandcastles, and a kite.", "Third Sunday in July", "little big family", "games outdoors", "beach"),

  // Sports games.
  idea("Opening-week ballgame", "Go to the same local baseball game each spring. Minor league counts.", "Third Saturday in April", "family grand", "sports", "city"),
  idea("Friday night lights", "Cheer at a hometown high school football game. Hot chocolate after.", "Third Friday in September", "big teens family", "sports", "country anywhere"),
  idea("Big-game snack spread", "Watch your team play. Everyone brings one snack.", "Fourth Sunday in October", "teens adults family", "sports dinner"),
  idea("Family fun run", "Walk or run a local fun run together, at any pace.", "First Saturday in June", "big teens family", "sports outdoors"),
  idea("Pickup game in the park", "Same park, same pickup soccer or basketball game, every year.", "Fourth Sunday in April", "big teens adults", "sports outdoors", "city"),
  idea("Ice skating day", "Skate at a rink or a frozen pond. Cocoa after.", "First Sunday in February", "little big teens family", "sports outdoors", "snowy city"),
  idea("Kids vs. grown-ups kickball", "Kids make the rules. Grown-ups play along.", "Third Sunday in August", "little big teens adults", "sports games outdoors", "warm anywhere"),
  idea("Same sledding hill", "Go back to the same sledding hill every winter.", "Third Sunday in December", "little big teens", "sports outdoors", "snowy"),

  // Music.
  idea("Pots-and-pans band", "Pots, pans, and spoons. Write one silly family song.", "Third Friday in March", "little big", "music"),
  idea("Concert in the park", "Find a free outdoor concert. Bring a blanket.", "Second Friday in July", "family grand", "music outdoors", "city"),
  idea("Dish-duty karaoke", "Sing your hearts out while doing the dishes.", "Fourth Friday in April", "big teens family", "music", "anywhere", "any"),
  idea("Our year in songs", "Everyone adds three songs from their year. Play them on a drive.", "Third Sunday in December", "teens adults", "music"),
  idea("Record store Saturday", "Each person brings home one record or song they love.", "Third Saturday in April", "teens adults", "music", "city"),
  idea("Lullaby night", "Grown-ups sing the lullabies they were sung as kids.", "Second Wednesday in March", "little grand", "music"),
  idea("Campfire sing-along", "Simple songs and s'mores around a fire.", "Fourth Saturday in September", "family", "music outdoors", "country"),

  // Outdoors.
  idea("Tide-pool morning", "Look for crabs and shells at low tide. Put everything back.", "Second Saturday in July", "little big", "outdoors", "beach"),
  idea("First hike of spring", "Same trail every spring. Take a picture at the same spot.", "Third Sunday in March", "family", "outdoors", "country"),
  idea("Rooftop sunset", "Watch the sunset from a rooftop or the highest park in town.", "Fourth Friday in June", "teens adults", "outdoors", "city"),
  idea("Kite day", "Fly kites on the first windy weekend of spring.", "First Sunday in April", "little big family", "outdoors", "beach country anywhere"),
  idea("Apple picking", "Pick apples, then bake something with them.", "Fourth Sunday in September", "little big family", "outdoors", "country"),
  idea("Night swim", "A late swim on a hot summer night.", "First Saturday in August", "big teens family", "outdoors", "beach warm"),
  idea("Sprinkler party", "Turn on the sprinkler. Popsicles after.", "Second Sunday in July", "little big", "outdoors", "warm"),
  idea("City lights walk", "Walk downtown after dark to see the lights.", "First Saturday in December", "family", "outdoors", "city"),

  // Crafts.
  idea("Pinecone bird feeders", "Roll pinecones in seed and hang them for the birds.", "First Sunday in December", "little big", "crafts outdoors", "snowy country"),
  idea("Time capsule day", "Each person adds a note and a small thing. Open it in five years.", "First Sunday in September", "family", "crafts"),
  idea("Handprint poster", "Trace everyone's hands on the same poster each year.", "Fourth Sunday in February", "little big family", "crafts"),
  idea("No-snow snow day", "No snow where you live? Cut paper snowflakes and have cocoa anyway.", "Third Saturday in January", "little big", "crafts", "warm"),
  idea("Cardboard boat day", "Build a boat from boxes and see if it floats.", "Fourth Sunday in July", "big teens", "crafts outdoors", "warm beach"),
  idea("Teen-planned day out", "A teen plans the day: where to go and where to eat.", "First Saturday in September", "teens family", "outdoors restaurants", "anywhere", "any"),

  // Giving.
  idea("Give-away Saturday", "Everyone picks toys or clothes to give to someone who needs them.", "Fourth Saturday in March", "little big teens family", "giving"),
  idea("Park clean-up", "Bring gloves and bags. Clean up your favorite park.", "Fourth Saturday in April", "big teens family", "giving outdoors", "city anywhere"),
  idea("Thank-you cookie run", "Bake cookies for firefighters, nurses, or the mail carrier.", "Second Saturday in December", "little big family", "giving"),
  idea("Outgrown-coat drive", "Gather coats you've outgrown and donate them.", "First Saturday in November", "family", "giving", "snowy"),
];

export const TAG_LABELS = Object.fromEntries([...SEASONS, ...AGES, ...TYPES, ...PLACES]);

export function ideaBySlug(slug) {
  const key = String(slug || "").trim().toLowerCase();
  return IDEAS.find((idea) => idea.slug === key) || null;
}

export function ideaRecurType(idea) {
  const rule = idea ? parseTiming(idea.timing) : null;
  return rule?.type === "nth_weekday" ? "nth_weekday" : "fixed";
}

export function nextIdeaDate(idea, fromIso) {
  const from = String(fromIso || "").slice(0, 10);
  const rule = idea ? parseTiming(idea.timing) : null;
  if (!rule || !/^\d{4}-\d{2}-\d{2}$/.test(from)) return from;
  const year = Number(from.slice(0, 4));
  for (let y = year; y <= year + 2; y++) {
    const date = occurDate(rule, y);
    if (date && date >= from) return date;
  }
  return from;
}

/**
 * Same matching the Ideas page runs in the browser (public/app.js).
 * `picked` is { season, age, type, place }; an empty value means "All".
 * "Whole family" ideas show for every age; "Anywhere" ideas show for every place.
 */
export function ideaMatches(idea, picked = {}) {
  const { season, age, type, place } = picked;
  if (season && !idea.seasons.includes(season) && !idea.seasons.includes("any")) return false;
  if (age && !idea.ages.includes(age) && !(age !== "adults" && age !== "grand" && idea.ages.includes("family"))) return false;
  if (type && !idea.types.includes(type)) return false;
  if (place && !idea.places.includes(place) && !idea.places.includes("anywhere")) return false;
  return true;
}

export function filterIdeas(picked) {
  return IDEAS.filter((idea) => ideaMatches(idea, picked));
}

function tagLine(idea) {
  const age = idea.ages.includes("family") ? "family" : idea.ages[0];
  const bits = [TAG_LABELS[idea.types[0]], TAG_LABELS[age]];
  return bits.filter(Boolean).join(" · ");
}

function chipRow(key, label, options) {
  const chips = [["", "All"], ...options].map(([value, text]) =>
    `<button type="button" class="chip" data-filter="${esc(key)}" data-value="${esc(value)}" aria-pressed="${value ? "false" : "true"}">${esc(text)}</button>`
  ).join("");
  return `<div class="chip-row" role="group" aria-label="${esc(label)}"><span class="chip-label">${esc(label)}</span><div class="chips">${chips}</div></div>`;
}

function selectFor(key, label, options) {
  const opts = [["", "Choose (optional)"], ...options].map(([value, text]) => `<option value="${esc(value)}">${esc(text)}</option>`).join("");
  return `<label for="share-${esc(key)}">${esc(label)}</label><select id="share-${esc(key)}" name="${esc(key)}">${opts}</select>`;
}

export function renderIdeasBody() {
  const cards = IDEAS.map((idea) => `
    <article class="card idea-card" data-season="${esc(idea.seasons.join(" "))}" data-age="${esc(idea.ages.join(" "))}" data-type="${esc(idea.types.join(" "))}" data-place="${esc(idea.places.join(" "))}">
      <h2>${esc(idea.name)}</h2>
      <p class="idea-how">${esc(idea.practice)}</p>
      <p class="idea-when">${esc(idea.timing)}<span class="idea-tags"> · ${esc(tagLine(idea))}</span></p>
      <a class="btn" href="/calendar?idea=${esc(idea.slug)}">Make it ours</a>
    </article>`).join("");
  const filters = FILTERS.map(([key, label, options]) => chipRow(key, label, options)).join("");
  return `
    <div class="ideas-page">
    <h1>Ideas</h1>
    <p class="lead">Borrow one. Make it yours.</p>
    <p class="support">Not a contest. Just days a family can keep at home.</p>
    <p class="share-jump"><a class="btn secondary" href="#share-idea">Share an idea</a></p>
    <div class="idea-filters" id="idea-filters" hidden>
      ${filters}
      <p class="hint idea-reset hidden" id="idea-reset"><button type="button" class="text-btn" id="idea-reset-btn">Show all ideas</button></p>
    </div>
    <p class="empty hidden" id="idea-empty">Nothing matches yet. Try fewer filters, or share one below.</p>
    <div class="idea-list" id="idea-list">
      ${cards}
    </div>
    <section class="card share-idea" id="share-idea">
      <h2>Share an idea</h2>
      <p class="hint">Got a tradition another family might love? We read every one before adding it here. No names are shown.</p>
      <form id="idea-share-form" method="post" action="/api/ideas/share">
        <label for="share-name">What do you call it?</label>
        <input id="share-name" name="name" type="text" required minlength="2" maxlength="${IDEA_NAME_MAX}" placeholder="Pancake Saturday">
        <label for="share-practice">How do you do it? (one line)</label>
        <input id="share-practice" name="practice" type="text" required minlength="5" maxlength="${IDEA_PRACTICE_MAX}" placeholder="Everyone flips one pancake.">
        <label for="share-timing">When? (optional)</label>
        <input id="share-timing" name="timing" type="text" maxlength="${IDEA_TIMING_MAX}" placeholder="First Saturday in March">
        ${selectFor("season", "Season", SEASONS)}
        ${selectFor("age", "Who is it for?", AGES)}
        ${selectFor("type", "Type", TYPES)}
        <div class="hp" aria-hidden="true"><label for="share-website">Leave this empty</label><input id="share-website" name="website" type="text" tabindex="-1" autocomplete="off"></div>
        <button class="btn" type="submit">Send our idea</button>
        <p class="error hidden" id="idea-share-error"></p>
        <p class="ok hidden" id="idea-share-ok" role="status">Thank you! We'll read it soon.</p>
      </form>
    </section>
    <p class="start-own-quiet"><a href="/">Back</a></p>
    </div>`;
}

export const IDEA_NAME_MAX = 80;
export const IDEA_PRACTICE_MAX = 200;
export const IDEA_TIMING_MAX = 80;
