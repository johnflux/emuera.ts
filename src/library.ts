import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rename, rm, rmdir, lstat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { discoverGames, isGameRoot } from "./loader.js";
import { downloadArchive, extractArchive } from "./archive.js";

export interface CatalogGame {
  id: string;
  title: string;
  blurb: string;
  genre: string;
  folder: string;
  source: string;
  monogram?: string;
  stars?: number;
  requirements?: string;
  downloadOnly?: boolean;
  submodules?: boolean;
  archive?: string;
  repository?: string;
  branch?: string;
}

export const CATALOG_UPDATED = "2026-10-26";
/** Top ten public GitGud era-game search results by stars, excluding tools/unrelated projects, plus the three known games. */
export const GAME_CATALOG: readonly CatalogGame[] = [
  {
    id: "tw", title: "eraToho The World", genre: "Life simulation", folder: "anon-tw-anon-tw_eng-modding",
    blurb: "Explore Gensokyo, meet its residents, and build your own everyday life in a Touhou-inspired world.",
    source: "https://gitgud.io/Legis1998/anon-tw", monogram: "TW",
    archive: "https://gitgud.io/Legis1998/anon-tw/-/archive/anon-tw_eng-modding/anon-tw-anon-tw_eng-modding.zip",
  },
  {
    id: "k", title: "eraTohoK", genre: "Strategy", folder: "eraTohoK",
    blurb: "A Touhou-inspired strategy game. Choose a scenario and lead your faction through Gensokyo.",
    source: "https://gitgud.io/explore/projects?name=eraTohoK", monogram: "K",
  },
  {
    id: "rancek", title: "eraRanceK", genre: "Conquest", folder: "eraRanceK",
    blurb: "A Rance-inspired conquest game with factions, diplomacy, and a world of rival territories.",
    source: "https://gitgud.io/explore/projects?name=eraRance",
  },
  {
    id: "erauma", title: "EraUma", genre: "Training / story", folder: "erauma", stars: 119, monogram: "UM",
    blurb: "Become a trainer and build your own story in a world inspired by Uma Musume and the history of horse racing.",
    source: "https://gitgud.io/umaera/erauma", repository: "https://gitgud.io/umaera/erauma.git",
    requirements: "Uses its own era-electron engine and is not playable in this interpreter. Downloaded for source inspection only.",
    downloadOnly: true, submodules: true,
  },
  {
    id: "pops-tw", title: "Pops TW", genre: "Life simulation", folder: "pops-tw", stars: 91, monogram: "PT",
    blurb: "A Touhou life-simulation variant with time-stop powers and additional stories and content.",
    source: "https://gitgud.io/mrpopsalot/pops-tw", repository: "https://gitgud.io/mrpopsalot/pops-tw.git",
  },
  {
    id: "eratw-sub-modding", title: "eraTW Sub-modding", genre: "Life simulation / Chinese", folder: "eratw-sub-modding", stars: 87, monogram: "SM",
    blurb: "A Chinese-language TW variant based on version 4.881, combining expanded content, patches, and new features.",
    source: "https://gitgud.io/era-games-zh/touhou/eratw-sub-modding", repository: "https://gitgud.io/era-games-zh/touhou/eratw-sub-modding.git",
  },
  {
    id: "toho-reverse", title: "eraToho Reverse", genre: "Character simulation", folder: "eratohoreverse", stars: 65, monogram: "RV",
    blurb: "A Touhou character simulation that reverses the usual roles, with a custom protagonist and character-specific dialogue.",
    source: "https://gitgud.io/Pedy/eratohoreverse", repository: "https://gitgud.io/Pedy/eratohoreverse.git",
    requirements: "Uses Emuera-Anchor extensions. Title, normal character creation and initial training are tested here; full gameplay compatibility is not guaranteed.",
  },
  {
    id: "eraas", title: "eraAS", genre: "Post-apocalyptic", folder: "eraAS", stars: 58,
    blurb: "Post-apocalyptic world with random-generated girls and modular images.",
    source: "https://gitgud.io/era-games/eraAS", repository: "https://gitgud.io/era-games/eraAS.git",
  },
  {
    id: "erablue-resort", title: "erablue_resort", genre: "Management / adventure", folder: "erablue_resort", stars: 57, monogram: "BR",
    blurb: "Manage a resort and explore dungeons with Granblue Fantasy characters.",
    source: "https://gitgud.io/era-games/erablue_resort", repository: "https://gitgud.io/era-games/erablue_resort.git",
  },
  {
    id: "eraocg2", title: "eraOCG2", genre: "Card battles / Chinese", folder: "eraocg2", stars: 32, monogram: "CG",
    blurb: "A Yu-Gi-Oh! Tag Force-inspired fan game centered on card duels.",
    source: "https://gitgud.io/era-games-zh/doujin/eraocg2", repository: "https://gitgud.io/era-games-zh/doujin/eraocg2.git",
  },
  {
    id: "erafl", title: "eraFL", genre: "Fantasy sandbox / Japanese", folder: "erafl", stars: 27, monogram: "FL",
    blurb: "Build a life in an editable fantasy sandbox, meet its characters, and take on tabletop-style quests.",
    source: "https://gitgud.io/kom1t/erafl", repository: "https://gitgud.io/kom1t/erafl.git",
    requirements: "Uses a customized Emuera engine. Compatibility here is unverified.",
  },
  {
    id: "erasqn", title: "eraSQN", genre: "Fantasy / exploration", folder: "eraSQN", stars: 24, monogram: "SQ",
    blurb: "Play a magician, summon mythical companions, and send them exploring dungeons. Includes individual personalities and endings.",
    source: "https://gitgud.io/Pedy/eraSQN", repository: "https://gitgud.io/Pedy/eraSQN.git",
  },
  {
    id: "eramegaten", title: "eraMegaten", genre: "RPG / Japanese", folder: "eramegaten_p", stars: 17, monogram: "MT",
    blurb: "A Megami Tensei-inspired fan RPG with demons, character roles, and exploration, built on the ShinEraTensei branch.",
    source: "https://gitgud.io/bazzile/eramegaten_p", repository: "https://gitgud.io/bazzile/eramegaten_p.git",
    requirements: "Uses .NET Emuera extensions. Compatibility here is unverified.",
  },
];

const exec = promisify(execFile);
export type PrepareGame = (game: CatalogGame, destination: string) => Promise<void>;
const prepareGame: PrepareGame = async (game, destination) => {
  if (game.archive) {
    const archive = destination + ".zip";
    await downloadArchive(game.archive, archive);
    await extractArchive(archive, destination);
    return;
  }
  await exec("git", [
    "-c", "core.hooksPath=/dev/null", "clone", "--depth", "1",
    ...(game.submodules ? ["--recurse-submodules", "--shallow-submodules"] : []),
    ...(game.branch ? ["--branch", game.branch] : []), "--", game.repository!, destination,
  ], { timeout: 10 * 60_000, maxBuffer: 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
};

/** Prepare out of the discovery/watch tree; publish only a complete game and never replace a user's folder. */
export async function installGame(game: CatalogGame, gamesDir: string, prepare: PrepareGame = prepareGame): Promise<void> {
  if (!game.repository && !game.archive) throw new Error("This game requires a manual download.");
  gamesDir = path.resolve(gamesDir);
  await mkdir(gamesDir, { recursive: true });
  const destinationRoot = game.downloadOnly ? path.join(gamesDir, ".downloads") : gamesDir;
  await mkdir(destinationRoot, { recursive: true });
  const destination = path.join(destinationRoot, game.folder);
  try {
    await lstat(destination);
    throw new Error(`GAMES/${game.folder} already exists. It has not been changed.`);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
  const staging = await mkdtemp(path.join(path.dirname(gamesDir), ".era-install-"));
  try {
    const checkout = path.join(staging, "checkout");
    await prepare(game, checkout);
    const roots = isGameRoot(checkout) ? [checkout] : discoverGames(checkout, []).map((definition) => definition.root);
    if (!game.downloadOnly && roots.length !== 1) throw new Error("Expected one game with ERB and CSV folders. Use the project download instructions instead.");
    const source = game.archive && roots.length === 1 ? roots[0]! : checkout;
    // Reserve the target before renaming so even an empty existing folder cannot be replaced.
    await mkdir(destination);
    try { await rename(source, destination); }
    catch (error) { await rmdir(destination); throw error; }
  } finally { await rm(staging, { recursive: true, force: true }); }
}

export async function downloadedCatalogGames(gamesDir: string): Promise<string[]> {
  const downloaded: string[] = [];
  for (const game of GAME_CATALOG.filter((item) => item.downloadOnly)) {
    try {
      await lstat(path.join(path.resolve(gamesDir), ".downloads", game.folder));
      downloaded.push(game.id);
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    }
  }
  return downloaded;
}
