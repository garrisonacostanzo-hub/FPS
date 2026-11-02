// Team colours as the local player sees them. By default colours are relative: your side is always blue and
// the other side is always red (or yellow in the colour-blind palette), whichever team you are on. The
// "classic" option keeps fixed Alpha blue / Bravo orange.
import { TEAM, TEAM_COLORS, TEAM_NAMES } from '../shared/constants.js';
import { settings } from './settings.js';

export const PALETTES = {
  standard: { ally: '#1e90ff', enemy: '#ff2020', allySoft: '#9cc8ff', enemySoft: '#ff9a8a' },
  colorblind: { ally: '#1e90ff', enemy: '#ffc400', allySoft: '#9cc8ff', enemySoft: '#ffe08a' },
};
const NEUTRAL = '#e8e8e8';

export class TeamPalette {
  constructor() {
    this.myTeam = TEAM.NONE;
    this.myId = -1;
    this.teams = true;
  }

  setContext(myId, myTeam, teamsMode) {
    this.myId = myId;
    this.myTeam = myTeam;
    this.teams = teamsMode;
  }

  get relative() { return settings.teamColors !== 'classic'; }

  get colors() { return settings.teamColors === 'colorblind' ? PALETTES.colorblind : PALETTES.standard; }

  /** Is this team on my side? In free-for-all nobody else is. */
  isAllyTeam(team) {
    return this.teams && team !== TEAM.NONE && team === this.myTeam;
  }

  /** Colour of a team (scores, zones, scoreboard headers, announcements). */
  team(team) {
    if (team !== TEAM.A && team !== TEAM.B) return NEUTRAL;
    if (!this.relative) return TEAM_COLORS[team];
    return this.isAllyTeam(team) ? this.colors.ally : this.colors.enemy;
  }

  /** Colour of a specific player (characters, kill feed, minimap): works for free-for-all too. */
  entity(id, team) {
    const ally = id === this.myId || this.isAllyTeam(team);
    if (!this.relative) return this.teams ? TEAM_COLORS[team] || NEUTRAL : (id === this.myId ? PALETTES.standard.ally : TEAM_COLORS[TEAM.B]);
    return ally ? this.colors.ally : this.colors.enemy;
  }

  isAlly(id, team) {
    return id === this.myId || this.isAllyTeam(team);
  }

  /** Softer tint for tracers. */
  tracer(id, team) {
    return this.isAlly(id, team) ? this.colors.allySoft : this.colors.enemySoft;
  }

  /** Label like "ALPHA (YOUR TEAM)". */
  teamLabel(team) {
    const name = TEAM_NAMES[team] || '';
    return this.isAllyTeam(team) ? `${name} · YOUR TEAM` : `${name} · ENEMY`;
  }
}
