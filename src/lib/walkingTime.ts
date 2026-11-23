import type { WalkingTime } from '../types';

export interface WalkingParams {
  distanceKm: number;
  ascent: number;
  descent: number;
  /** Mode « Sac lourd ». */
  heavyPack: boolean;
}

const STANDARD_FLAT_KMH = 4;
const HEAVY_PACK_FLAT_KMH = 3.2;
const ASCENT_M_PER_HOUR = 300;
const DESCENT_M_PER_HOUR = 600;
const HEAVY_PACK_PAUSE_MIN_PER_HOUR = 10;

/**
 * Temps de marche selon la norme DIN 33466 (méthode suisse) :
 * - temps horizontal : distance à 4 km/h (3,2 km/h en mode sac lourd) ;
 * - temps vertical : 1 h par 300 m de D+ et 1 h par 600 m de D- ;
 * - total = le plus grand des deux + la moitié du plus petit.
 * En mode sac lourd, on ajoute une pause de 10 min à la fin de chaque heure de marche
 * (pas de pause comptée après l'arrivée).
 */
export function computeWalkingTime({ distanceKm, ascent, descent, heavyPack }: WalkingParams): WalkingTime {
  const flatSpeedKmh = heavyPack ? HEAVY_PACK_FLAT_KMH : STANDARD_FLAT_KMH;
  const horizontalH = distanceKm / flatSpeedKmh;
  const verticalH = ascent / ASCENT_M_PER_HOUR + descent / DESCENT_M_PER_HOUR;
  const walkH = Math.max(horizontalH, verticalH) + Math.min(horizontalH, verticalH) / 2;
  const walkMinutes = walkH * 60;
  const pauseMinutes = heavyPack ? Math.max(0, Math.ceil(walkH) - 1) * HEAVY_PACK_PAUSE_MIN_PER_HOUR : 0;
  return {
    walkMinutes,
    pauseMinutes,
    totalMinutes: walkMinutes + pauseMinutes,
    flatSpeedKmh,
  };
}
