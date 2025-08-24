const fs = require('fs');
const path = require('path');

function readJSON(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    console.error(`Error reading ${file}: ${e.message}`);
    return null;
  }
}

function writeJSON(file, obj) {
  fs.writeFileSync(file, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

function isPlainObject(v) {
  return v && typeof v === 'object' && !Array.isArray(v);
}

// Merge target into reference shape: keep only keys present in ref.
// - For objects: recurse
// - For primitives: keep target value if defined, otherwise fallback to ref value
function mergeWithReferenceShape(ref, target) {
  if (!isPlainObject(ref)) {
    return target !== undefined ? target : ref;
  }
  const result = {};
  for (const key of Object.keys(ref)) {
    const refVal = ref[key];
    const tgtVal = target && Object.prototype.hasOwnProperty.call(target, key) ? target[key] : undefined;
    result[key] = mergeWithReferenceShape(refVal, tgtVal);
  }
  return result;
}

function main() {
  const localesDir = path.join(__dirname, 'public', 'locales');
  const frFile = path.join(localesDir, 'fr', 'translation.json');
  const frData = readJSON(frFile);
  if (!frData) {
    console.error('Cannot read French reference file. Aborting.');
    process.exit(1);
  }

  const dirs = fs.readdirSync(localesDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name)
    .filter(lang => lang !== 'fr');

  console.log(`Reference: fr (${Object.keys(frData).length} top-level keys)`);
  console.log(`Locales to update: ${dirs.join(', ')}`);

  const updated = [];
  for (const lang of dirs) {
    const file = path.join(localesDir, lang, 'translation.json');
    let data = readJSON(file);
    if (!data) {
      console.warn(`Locale ${lang}: missing or invalid file. Creating from fr.`);
      writeJSON(file, frData);
      updated.push(lang);
      continue;
    }
    const merged = mergeWithReferenceShape(frData, data);
    writeJSON(file, merged);
    updated.push(lang);
  }

  console.log(`Updated ${updated.length} locales to match French structure.`);
}

if (require.main === module) {
  main();
}