export function withLibraryMagic(Base) {
  return class LibraryMagic extends Base {
  lightColorCss(r) {
    const rgb = this.lightColorRgb(r);
    return rgb ? 'rgb(' + rgb.join(', ') + ')' : '';
  }

  lightColorHex(r) {
    const rgb = this.lightColorRgb(r);
    return rgb ? this.rgbToHex(rgb) : '';
  }

  lightColorRgb(r) {
    const c = r && r.data && r.data.color;
    if (!Array.isArray(c) || c.length < 3) return null;
    const rgb = c.slice(0, 3).map(v => Math.max(0, Math.min(255, parseInt(v, 10) || 0)));
    return this.isNegativeLight(r) ? rgb.map(v => 255 - v) : rgb;
  }

  isNegativeLight(r) {
    return /\bNEGATIVE\b/i.test(String((r && r.data && r.data.flags) || ''));
  }

  rgbToHex(rgb) {
    return '#' + rgb.map(v => {
      const h = Math.max(0, Math.min(255, parseInt(v, 10) || 0)).toString(16);
      return h.length === 1 ? '0' + h : h;
    }).join('');
  }

  parseColorQuery(query) {
    const s = String(query || '').trim();
    const six = /#?([0-9a-f]{6})(?:~(\d{1,3}))?/i.exec(s);
    const three = /#([0-9a-f]{3})(?:~(\d{1,3}))?/i.exec(s);
    const m = six || three;
    if (!m) return null;
    let hex = m[1].toLowerCase();
    if (hex.length === 3) hex = hex.split('').map(ch => ch + ch).join('');
    const rgb = [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16));
    const tolerance = Math.max(0, Math.min(255, parseInt(m[2], 10) || 48));
    return { hex: '#' + hex, rgb, tolerance, toleranceSq: tolerance * tolerance };
  }

  colorDistanceSq(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b)) return Infinity;
    const dr = (a[0] || 0) - (b[0] || 0);
    const dg = (a[1] || 0) - (b[1] || 0);
    const db = (a[2] || 0) - (b[2] || 0);
    return dr * dr + dg * dg + db * db;
  }

  ingredientEffectIconMap() {
    if (this._ingredientEffectIconMap) return this._ingredientEffectIconMap;
    this._ingredientEffectIconMap = {
      AbsorbAttribute: 'b_tx_s_ab_attrib.webp',
      AbsorbFatigue: 'b_tx_s_ab_fati.webp',
      AbsorbHealth: 'b_tx_s_ab_health.webp',
      AbsorbMagicka: 'b_tx_s_ab_magic.webp',
      AbsorbSkill: 'b_tx_s_ab_skill.webp',
      AlmsiviIntervention: 'b_tx_s_alm_intervt.webp',
      Blind: 'b_tx_s_blind.webp',
      BoundBattleAxe: 'b_tx_s_bd_battleaxe.webp',
      BoundBoots: 'b_tx_s_bd_boots.webp',
      BoundCuirass: 'b_tx_s_bd_cuirass.webp',
      BoundDagger: 'b_tx_s_bd_dagger.webp',
      BoundGloves: 'b_tx_s_bd_gloves.webp',
      BoundHelm: 'b_tx_s_bd_helm.webp',
      BoundLongbow: 'b_tx_s_bd_lngbow.webp',
      BoundLongsword: 'b_tx_s_bd_lngswd.webp',
      BoundMace: 'b_tx_s_bd_mace.webp',
      BoundShield: 'b_tx_s_bd_shield.webp',
      BoundSpear: 'b_tx_s_bd_spear.webp',
      Burden: 'b_tx_s_burden.webp',
      CalmCreature: 'b_tx_s_cm_crture.webp',
      CalmHumanoid: 'b_tx_s_cm_hunoid.webp',
      Chameleon: 'b_tx_s_chameleon.webp',
      Charm: 'b_tx_s_charm.webp',
      CommandCreature: 'b_tx_s_cmd_crture.webp',
      CommandHumanoid: 'b_tx_s_cmd_hunoid.webp',
      Corprus: 'b_tx_s_corprus.webp',
      CureBlightDisease: 'b_tx_s_cure_bghtdise.webp',
      CureCommonDisease: 'b_tx_s_cure_comdise.webp',
      CureCorprusDisease: 'b_tx_s_cure_corpus.webp',
      CureParalyzation: 'b_tx_s_cure_paralyse.webp',
      CurePoison: 'b_tx_s_cure_poision.webp',
      DamageAttribute: 'b_tx_s_dmg_attrib.webp',
      DamageFatigue: 'b_tx_s_dmg_fati.webp',
      DamageHealth: 'b_tx_s_dmg_health.webp',
      DamageMagicka: 'b_tx_s_dmg_magic.webp',
      DamageSkill: 'b_tx_s_dmg_skill.webp',
      DemoralizeCreature: 'b_tx_s_demorl_crture.webp',
      DemoralizeHumanoid: 'b_tx_s_demorl_hunoid.webp',
      DetectAnimal: 'b_tx_s_detect_animal.webp',
      DetectEnchantment: 'b_tx_s_detect_enchtmt.webp',
      DetectKey: 'b_tx_s_detect_key.webp',
      DisintegrateArmor: 'b_tx_s_disintgt_armor.webp',
      DisintegrateWeapon: 'b_tx_s_disintgt_wpn.webp',
      Dispel: 'b_tx_s_dispel.webp',
      DivineIntervention: 'b_tx_s_divine_intervt.webp',
      DrainAttribute: 'b_tx_s_drain_attrib.webp',
      DrainFatigue: 'b_tx_s_drain_fati.webp',
      DrainHealth: 'b_tx_s_drain_health.webp',
      DrainMagicka: 'b_tx_s_drain_magic.webp',
      DrainSkill: 'b_tx_s_drain_skill.webp',
      Feather: 'b_tx_s_feather.webp',
      FireDamage: 'b_tx_s_fire_damage.webp',
      FireShield: 'b_tx_s_fire_shield.webp',
      FortifyAttackBonus: 'b_tx_s_ftfy_attack.webp',
      FortifyAttribute: 'b_tx_s_ftfy_attrib.webp',
      FortifyFatigue: 'b_tx_s_ftfy_fati.webp',
      FortifyHealth: 'b_tx_s_ftfy_health.webp',
      FortifyMagicka: 'b_tx_s_ftfy_magic.webp',
      FortifyMagickaMultiplier: 'b_tx_s_ftfy_mgcmtplr.webp',
      FortifySkill: 'b_tx_s_ftfy_skill.webp',
      FrenzyCreature: 'b_tx_s_frzy_crture.webp',
      FrenzyHumanoid: 'b_tx_s_frzy_hunoid.webp',
      FrostDamage: 'b_tx_s_frost_dmg.webp',
      FrostShield: 'b_tx_s_frost_shield.webp',
      Invisibility: 'b_tx_s_invisible.webp',
      Jump: 'b_tx_s_jump.webp',
      Levitate: 'b_tx_s_levitate.webp',
      Light: 'b_tx_s_light.webp',
      LightningShield: 'b_tx_s_light_shield.webp',
      Lock: 'b_tx_s_lock.webp',
      Mark: 'b_tx_s_mark.webp',
      NightEye: 'b_tx_s_night_eye.webp',
      Open: 'b_tx_s_open.webp',
      Paralyze: 'b_tx_s_paralyse.webp',
      Poison: 'b_tx_s_poison.webp',
      RallyCreature: 'b_tx_s_rlly_crture.webp',
      RallyHumanoid: 'b_tx_s_rlly_hunoid.webp',
      Recall: 'b_tx_s_recall.webp',
      Reflect: 'b_tx_s_reflect.webp',
      RemoveCurse: 'b_tx_s_rem_curse.webp',
      ResistBlightDisease: 'b_tx_s_rst_bghtdise.webp',
      ResistCommonDisease: 'b_tx_s_rst_comdise.webp',
      ResistCorprusDisease: 'b_tx_s_rst_cpsdise.webp',
      ResistFire: 'b_tx_s_rst_fire.webp',
      ResistFrost: 'b_tx_s_rst_frost.webp',
      ResistMagicka: 'b_tx_s_rst_magic.webp',
      ResistNormalWeapons: 'b_tx_s_rst_nmlwpn.webp',
      ResistParalysis: 'b_tx_s_rst_plysis.webp',
      ResistPoison: 'b_tx_s_rst_poison.webp',
      ResistShock: 'b_tx_s_rst_shock.webp',
      RestoreAttribute: 'b_tx_s_rstor_attrib.webp',
      RestoreFatigue: 'b_tx_s_rstor_fatigue.webp',
      RestoreHealth: 'b_tx_s_rstor_health.webp',
      RestoreMagicka: 'b_tx_s_rstor_magic.webp',
      RestoreSkill: 'b_tx_s_rstor_skill.webp',
      Sanctuary: 'b_tx_s_sanctuary.webp',
      Shield: 'b_tx_s_shield.webp',
      ShockDamage: 'b_tx_s_shock_dmg.webp',
      Silence: 'b_tx_s_silence.webp',
      SlowFall: 'b_tx_s_slowfall.webp',
      Soultrap: 'b_tx_s_soultrap.webp',
      Sound: 'b_tx_s_sound.webp',
      SpellAbsorption: 'b_tx_s_spll_absb.webp',
      SummonAncestralGhost: 'b_tx_s_smmn_anctlght.webp',
      SummonBear: 'b_tx_s_smmn_bear.webp',
      SummonBonewolf: 'b_tx_s_smmn_bonewolf.webp',
      SummonBonelord: 'b_tx_s_smmn_bnlord.webp',
      SummonClannfear: 'b_tx_s_smmn_clnfear.webp',
      SummonDaedroth: 'b_tx_s_smmn_daedth.webp',
      SummonDremora: 'b_tx_s_smmn_drmora.webp',
      SummonFabricant: 'b_tx_s_smmn_fabrict.webp',
      SummonFlameAtronach: 'b_tx_s_smmn_flmatrnh.webp',
      SummonFrostAtronach: 'b_tx_s_smmn_frstatrnh.webp',
      SummonGoldenSaint: 'b_tx_s_smmn_gldsaint.webp',
      SummonGreaterBonewalker: 'b_tx_s_smmn_grtrbnwlkr.webp',
      SummonHunger: 'b_tx_s_smmn_hunger.webp',
      SummonLeastBonewalker: 'b_tx_s_smmn_lstbnwlkr.webp',
      SummonScamp: 'b_tx_s_smmn_scamp.webp',
      SummonSkeletonMinion: 'b_tx_s_smmn_skltlmnn.webp',
      SummonStormAtronach: 'b_tx_s_smmn_stmatnh.webp',
      SummonWingedTwilight: 'b_tx_s_smmn_wngtwlght.webp',
      SummonWolf: 'b_tx_s_smmn_wolf.webp',
      SunDamage: 'b_tx_s_sun_dmg.webp',
      SwiftSwim: 'b_tx_s_swiftswim.webp',
      Telekinesis: 'b_tx_s_telekinesis.webp',
      TurnUndead: 'b_tx_s_turn_undead.webp',
      Vampirism: 'b_tx_s_vampire.webp',
      WaterBreathing: 'b_tx_s_water_breath.webp',
      WaterWalking: 'b_tx_s_water_walk.webp',
      WeaknessToBlightDisease: 'b_tx_s_wknstoblghtdise.webp',
      WeaknessToCommonDisease: 'b_tx_s_wknstocomdise.webp',
      WeaknessToCorprusDisease: 'b_tx_s_wknstocpsdise.webp',
      WeaknessToFire: 'b_tx_s_wknstofire.webp',
      WeaknessToFrost: 'b_tx_s_wknstofrost.webp',
      WeaknessToMagicka: 'b_tx_s_wknstomagic.webp',
      WeaknessToNormalWeapons: 'b_tx_s_wknstonmlwpns.webp',
      WeaknessToPoison: 'b_tx_s_wknstopoison.webp',
      WeaknessToShock: 'b_tx_s_wknstoshock.webp',
    };
    return this._ingredientEffectIconMap;
  }

  ingredientEffectLabel(rawEffect, skill, attribute) {
    const effect = String(rawEffect || '').trim();
    if (!effect || effect === 'None') return '';
    const labels = {
      FortifyAttackBonus: 'Fortify Attack',
      FortifyMagickaMultiplier: 'Fortify Maximum Magicka',
      NightEye: 'Night Eye',
      SlowFall: 'SlowFall',
      SpellAbsorption: 'Spell Absorption',
      SwiftSwim: 'Swift Swim',
      WaterBreathing: 'Water Breathing',
      WaterWalking: 'Water Walking',
    };
    const attr = String(attribute || '').trim();
    const skl = String(skill || '').trim();
    if (/Attribute$/.test(effect) && attr && attr !== 'None') {
      return this.effectBaseLabel(effect.replace(/Attribute$/, '')) + ' ' + attr;
    }
    if (/Skill$/.test(effect) && skl && skl !== 'None') {
      return this.effectBaseLabel(effect.replace(/Skill$/, '')) + ' ' + skl;
    }
    if (labels[effect]) return labels[effect];
    return this.effectBaseLabel(effect);
  }

  effectBaseLabel(value) {
    return String(value || '')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/\bTo\b/g, 'to')
      .replace(/\bMagicka\b/g, 'Magicka')
      .trim();
  }

  effectSearchKey(value) {
    return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
  }

  ingredientEffects(record) {
    const data = record && record.data;
    const effects = data && Array.isArray(data.effects) ? data.effects : null;
    if (!effects) return [];
    const skills = Array.isArray(data.skills) ? data.skills : [];
    const attributes = Array.isArray(data.attributes) ? data.attributes : [];
    const icons = this.ingredientEffectIconMap();
    const base = this._EFFECT || '';
    const out = [];
    const seen = Object.create(null);
    effects.slice(0, 4).forEach((raw, i) => {
      const effect = String(raw || '').trim();
      if (!effect || effect === 'None') return;
      const icon = icons[effect];
      const label = this.ingredientEffectLabel(effect, skills[i], attributes[i]);
      const key = this.effectSearchKey(label);
      if (!icon || !label || seen[key]) return;
      seen[key] = 1;
      out.push({
        label,
        key,
        img: base + icon,
        mode: 'ingredient',
      });
    });
    return out;
  }

  isEnchantableItem(record) {
    const type = this.labelType(record && record.type).toLowerCase();
    return type === 'armor' || type === 'book' || type === 'clothing' || type === 'weapon';
  }

  isAlchemyItem(record) {
    return this.labelType(record && record.type).toLowerCase() === 'alchemy';
  }

  enchantmentMap(records) {
    const out = Object.create(null);
    (records || []).forEach(r => {
      if (this.labelType(r && r.type).toLowerCase() !== 'enchanting') return;
      const key = String((r && r.id) || '').trim().toLowerCase();
      if (key && !out[key]) out[key] = r;
    });
    return out;
  }

  itemEnchantment(record, enchantmentsByKey) {
    if (!this.isEnchantableItem(record)) return null;
    const id = String((record && record.enchanting) || '').trim();
    if (!id) return null;
    const src = enchantmentsByKey && enchantmentsByKey[id.toLowerCase()];
    if (!src) return {
      id,
      label: id,
      title: 'Enchantment: ' + id,
      meta: 'Enchantment record not found',
      effects: [],
      rows: [],
    };
    const data = src.data || {};
    const type = this.enchantmentTypeLabel(data.enchant_type);
    const isConstantEffect = data.enchant_type === 'ConstantEffect';
    const rows = [
      { label: 'Type', value: type || 'Enchantment' },
    ];
    if (!isConstantEffect && data.cost != null) rows.push({ label: 'Cost', value: String(data.cost) });
    if (!isConstantEffect && data.max_charge != null) rows.push({ label: 'Charge', value: String(data.max_charge) });
    const meta = rows.slice(0, 3).map(r => r.value).filter(Boolean).join(' · ');
    return {
      id: src.id || id,
      label: src.id || id,
      title: 'Enchantment: ' + (src.id || id),
      meta: meta || 'Enchantment',
      rows,
      effects: this.magicEffectEntries(src.effects, 8, { constantEffect: isConstantEffect }),
    };
  }

  alchemyDetails(record) {
    if (!this.isAlchemyItem(record)) return null;
    const data = record && record.data ? record.data : {};
    const id = record && record.id ? record.id : '';
    const name = String((record && record.name) || '').trim();
    const rows = [];
    if (data.value != null) rows.push({ label: 'Value', value: String(data.value) });
    if (data.weight != null) rows.push({ label: 'Weight', value: String(data.weight) });
    if (data.flags) rows.push({ label: 'Flags', value: this.flagsLabel(data.flags) || String(data.flags) });
    const meta = rows.slice(0, 3).map(r => r.value).filter(Boolean).join(' Â· ');
    return {
      id,
      label: id,
      title: 'Alchemy: ' + (name || id),
      meta: meta || 'Alchemy',
      kind: 'alchemy',
      rows,
      effects: this.magicEffectEntries(record && record.effects, 8, { mode: 'alchemy' }),
    };
  }

  spellDetails(record) {
    if (!this.isSpellRecord(record)) return null;
    const data = record && record.data ? record.data : {};
    const id = record && record.id ? record.id : '';
    const name = String((record && record.name) || '').trim();
    const rows = [
      { label: 'Type', value: this.spellTypeLabel(data.spell_type) || 'Spell' },
    ];
    if (data.cost != null) rows.push({ label: 'Cost', value: String(data.cost) });
    const meta = rows.slice(0, 3).map(r => r.value).filter(Boolean).join(' Â· ');
    return {
      id,
      label: id,
      title: 'Spell: ' + (name || id),
      meta: meta || 'Spell',
      kind: 'spell',
      rows,
      effects: this.magicEffectEntries(record.effects, 8, { mode: 'spell' }),
    };
  }

  spellTypeLabel(value) {
    const map = {
      Spell: 'Spell',
      Ability: 'Ability',
      BlightDisease: 'Blight Disease',
      Disease: 'Disease',
      Curse: 'Curse',
      Power: 'Power',
    };
    return map[value] || this.effectBaseLabel(value);
  }

  spellThumbnailEffects(record) {
    const entries = this.magicEffectEntries(record && record.effects, 8, { mode: 'spell' });
    const out = [];
    const byIcon = Object.create(null);
    entries.forEach(entry => {
      const key = entry.img || entry.key;
      if (!key) return;
      let existing = byIcon[key];
      if (!existing) {
        existing = Object.assign({}, entry, { count: 0, labels: [] });
        byIcon[key] = existing;
        out.push(existing);
      }
      existing.count += 1;
      if (existing.labels.indexOf(entry.label) === -1) existing.labels.push(entry.label);
    });
    return out.map(entry => {
      const count = entry.count || 1;
      const labels = entry.labels && entry.labels.length ? entry.labels.join(', ') : entry.label;
      return Object.assign({}, entry, {
        scale: String(Math.min(1.58, 1 + (count - 1) * 0.18)),
        title: labels + (count > 1 ? ' x' + count : ''),
      });
    });
  }

  spellLayoutClass(count) {
    return 'asset-spell-layout-' + Math.max(1, Math.min(8, parseInt(count, 10) || 1));
  }

  enchantmentTypeLabel(value) {
    const map = {
      CastOnce: 'Cast Once',
      CastWhenUsed: 'Cast When Used',
      CastOnStrike: 'Cast On Strike',
      ConstantEffect: 'Constant Effect',
    };
    return map[value] || this.effectBaseLabel(value);
  }

  flagsLabel(value) {
    return String(value || '')
      .split('|')
      .map(x => x.trim())
      .filter(Boolean)
      .map(x => x.toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, ch => ch.toUpperCase()))
      .join(', ');
  }

  copyText(value) {
    const text = String(value || '');
    if (!text) return Promise.reject(new Error('No text to copy'));
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise((resolve, reject) => {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        ok ? resolve() : reject(new Error('Copy command failed'));
      } catch (e) {
        reject(e);
      }
    });
  }

  magicEffectEntries(effects, limit, options) {
    if (!Array.isArray(effects)) return [];
    const icons = this.ingredientEffectIconMap();
    const base = this._EFFECT || '';
    const constantEffect = !!(options && options.constantEffect);
    const mode = (options && options.mode) || 'enchant';
    return effects.slice(0, limit || 8).map(raw => {
      const effect = String((raw && raw.magic_effect) || raw || '').trim();
      if (!effect || effect === 'None') return null;
      const label = this.ingredientEffectLabel(effect, raw && raw.skill, raw && raw.attribute);
      const key = this.effectSearchKey(label);
      const icon = icons[effect];
      if (!label || !key || !icon) return null;
      const summary = this.magicEffectSummary(raw || {}, { constantEffect });
      return {
        label,
        key,
        img: base + icon,
        summary,
        title: summary ? label + ' · ' + summary : label,
        mode,
      };
    }).filter(Boolean);
  }

  magicEffectSummary(effect, options) {
    const bits = [];
    const constantEffect = !!(options && options.constantEffect);
    const range = this.effectBaseLabel(effect.range || '');
    if (range) bits.push(range);
    const min = effect.min_magnitude;
    const max = effect.max_magnitude;
    if (min != null || max != null) {
      const a = parseInt(min, 10) || 0;
      const b = parseInt(max, 10) || 0;
      if (a || b) bits.push(a === b ? String(a) : (a + '-' + b));
    }
    const duration = parseInt(effect.duration, 10) || 0;
    if (duration && !constantEffect) bits.push(duration + 's');
    const area = parseInt(effect.area, 10) || 0;
    if (area) bits.push(area + ' ft');
    return bits.join(' · ');
  }

  enchantmentPreviewPayload(x, detailKind) {
    const enchantment = detailKind === 'alchemy'
      ? (x && x.alchemy)
      : (detailKind === 'enchantment' ? (x && x.enchantment) : (x && (x.alchemy || x.enchantment)));
    if (!enchantment) return null;
    return {
      itemId: x.id || '',
      itemName: x.name || '',
      itemType: x.type || '',
      id: enchantment.id || '',
      title: enchantment.title || (enchantment.kind === 'alchemy' ? 'Alchemy' : 'Enchantment'),
      meta: enchantment.meta || '',
      kind: enchantment.kind || x.detailKind || 'enchantment',
      rows: enchantment.rows || [],
      effects: enchantment.effects || [],
      hasEffects: !!(enchantment.effects && enchantment.effects.length),
    };
  }

  enchantmentPreviewItemLabel(preview) {
    if (!preview) return '';
    if (preview.kind === 'alchemy' || preview.kind === 'spell') return preview.itemId || '';
    return (preview.itemName || preview.itemId || '') + (preview.itemType ? (' ' + String.fromCharCode(183) + ' ' + preview.itemType) : '');
  }
  };
}
