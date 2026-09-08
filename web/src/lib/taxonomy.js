// taxonomy.js — ONE definition of what can be reported.
//
// Imported by the SvelteKit frontend and, by relative path, by the submit
// endpoint's validator. `npm test` asserts this file matches the database
// exactly, so a category cannot exist in three places and mean three things.
//
// `class` decides how exposed a report is, and it is not cosmetic:
//   area_crime      → ward level, standard threshold. The place is the point.
//   person_directed → coarser geography and a higher threshold, because a rare
//                     event pinned to a small ward identifies the victim.
// Hazards are not here as a class: they have no victim, carry an exact point
// and no threshold, and live in their own table.

export const CATEGORIES = {
  // --- area crime -----------------------------------------------------------
  mugging: { class: 'area_crime', amount: false, thana: false, subs:
    ['snatching', 'armed_robbery', 'vehicle_based', 'hijacking'] },
  theft: { class: 'area_crime', amount: false, thana: false, subs:
    ['pickpocketing', 'motorcycle_theft', 'vehicle_theft', 'burglary', 'shop_robbery'] },
  chadabaji: { class: 'area_crime', amount: true, thana: false, subs:
    ['shop_business', 'construction_site', 'transport', 'festival_event', 'land',
     'illegal_toll', 'protection_racket'] },
  land_grabbing: { class: 'area_crime', amount: true, thana: false, subs:
    ['eviction_threat', 'forced_occupation', 'fake_documents', 'boundary_encroachment'] },
  hooliganism: { class: 'area_crime', amount: false, thana: false, subs:
    ['street_fight', 'intimidation_display', 'vandalism', 'forced_shutdown'] },
  drugs_weapons: { class: 'area_crime', amount: false, thana: false, subs:
    ['dealing_spot', 'open_drug_use', 'arms_display', 'gambling_den'] },
  fraud_impersonation: { class: 'area_crime', amount: true, thana: false, subs:
    ['fake_police', 'fake_checkpoint', 'coerced_mobile_banking', 'fake_collection'] },
  transport_danger: { class: 'area_crime', amount: false, thana: false, subs:
    ['reckless_driving', 'street_racing', 'unlicensed_driver', 'dangerous_overtaking'] },
  police_misconduct: { class: 'area_crime', amount: true, thana: true, subs:
    ['gd_refused', 'bribe_to_file', 'bribe_to_drop', 'complicity_with_group',
     'direct_extortion', 'custodial_abuse', 'harassment_by_police', 'illegal_checkpoint'] },
  // --- person-directed ------------------------------------------------------
  harassment: { class: 'person_directed', amount: false, thana: false, subs:
    ['street_harassment', 'transport_groping', 'stalking', 'threats'] },
  assault: { class: 'person_directed', amount: false, thana: false, subs:
    ['physical_assault', 'weapon_assault', 'acid_attack'] },
  abduction: { class: 'person_directed', amount: false, thana: false, subs:
    ['kidnapping', 'attempted_abduction', 'trafficking_suspicion'] },
};

export const HAZARDS = {
  lighting:     ['streetlight_broken', 'streetlight_absent', 'dark_stretch'],
  road_surface: ['open_manhole', 'open_drain', 'broken_road', 'waterlogging'],
  footpath:     ['footpath_blocked', 'footpath_encroached', 'footpath_broken'],
  construction: ['unsafe_construction', 'debris_on_road', 'unmarked_excavation'],
  electrical:   ['dangling_wires', 'exposed_transformer'],
  crossing:     ['no_crossing', 'broken_signal', 'accident_blackspot'],
  obstruction:  ['abandoned_vehicle', 'blocking_parking'],
};

// "How it happened" — closed vocabularies, never free text.
export const METHOD = {
  offender_count:   ['one', 'two', 'three_to_five', 'more', 'unknown'],
  offender_vehicle: ['none', 'motorcycle', 'cng', 'car', 'bicycle', 'unknown'],
  weapon:           ['none', 'knife', 'firearm', 'blunt', 'acid', 'other', 'unknown'],
  approach:         ['from_behind', 'blocked_path', 'posed_as_official', 'followed',
                     'group_surrounded', 'other', 'unknown'],
};

export const TIME_BANDS = ['morning', 'afternoon', 'evening', 'night', 'unknown'];
export const AMOUNT_BANDS = ['under_1k', '1k_5k', '5k_25k', '25k_100k', 'over_100k'];
export const WHY_NOT = ['would_ask_for_money', 'connected_to_group',
  'would_tell_them_i_complained', 'nothing_would_happen', 'afraid_of_retaliation',
  'did_not_know_how', 'ashamed_or_blamed', 'other'];
export const OUTCOMES = ['gd_filed', 'gd_refused', 'no_action', 'money_demanded', 'other'];

export const categoryNames = () => Object.keys(CATEGORIES);
export const areaCrime = () => categoryNames().filter(c => CATEGORIES[c].class === 'area_crime');
export const personDirected = () => categoryNames().filter(c => CATEGORIES[c].class === 'person_directed');
export const subsOf = (c) => CATEGORIES[c]?.subs ?? [];
export const categoryOfSub = (s) =>
  categoryNames().find(c => CATEGORIES[c].subs.includes(s)) ?? null;
export const hazardCategoryOf = (s) =>
  Object.keys(HAZARDS).find(c => HAZARDS[c].includes(s)) ?? null;

// Categories where the site should show support resources beside the form,
// not just a thank-you. Not a legal category — a decency one.
export const SUPPORT_RESOURCE_CATEGORIES = ['harassment', 'assault', 'abduction'];
