const fs = require('fs');
const path = require('path');

// Fonction pour extraire toutes les clés d'un objet JSON de manière récursive
function extractKeys(obj, prefix = '') {
  const keys = [];
  
  for (const key in obj) {
    if (obj.hasOwnProperty(key)) {
      const fullKey = prefix ? `${prefix}.${key}` : key;
      
      if (typeof obj[key] === 'object' && obj[key] !== null && !Array.isArray(obj[key])) {
        // Récursion pour les objets imbriqués
        keys.push(...extractKeys(obj[key], fullKey));
      } else {
        // Clé finale (valeur primitive)
        keys.push(fullKey);
      }
    }
  }
  
  return keys;
}

// Fonction pour lire et parser un fichier JSON
function readTranslationFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    console.error(`Erreur lors de la lecture de ${filePath}:`, error.message);
    return null;
  }
}

// Fonction principale
function checkTranslations() {
  const localesDir = path.join(__dirname, 'public', 'locales');
  const englishFile = path.join(localesDir, 'en', 'translation.json');
  
  // Lire le fichier de référence (anglais)
  console.log('📖 Lecture du fichier de référence (anglais)...');
  const englishData = readTranslationFile(englishFile);
  
  if (!englishData) {
    console.error('❌ Impossible de lire le fichier anglais de référence');
    return;
  }
  
  // Extraire toutes les clés du fichier anglais
  const englishKeys = extractKeys(englishData).sort();
  console.log(`✅ ${englishKeys.length} clés trouvées dans le fichier anglais\n`);
  
  // Lire tous les dossiers de langues
  const languageDirs = fs.readdirSync(localesDir, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => dirent.name)
    .filter(lang => lang !== 'en'); // Exclure l'anglais
  
  console.log(`🌍 Langues à vérifier: ${languageDirs.join(', ')}\n`);
  
  let allLanguagesValid = true;
  const results = [];
  
  // Vérifier chaque langue
  for (const lang of languageDirs) {
    const langFile = path.join(localesDir, lang, 'translation.json');
    
    if (!fs.existsSync(langFile)) {
      console.log(`⚠️  ${lang}: Fichier translation.json manquant`);
      results.push({ lang, status: 'missing_file', missingKeys: [], extraKeys: [] });
      allLanguagesValid = false;
      continue;
    }
    
    const langData = readTranslationFile(langFile);
    
    if (!langData) {
      console.log(`❌ ${lang}: Erreur de lecture du fichier`);
      results.push({ lang, status: 'read_error', missingKeys: [], extraKeys: [] });
      allLanguagesValid = false;
      continue;
    }
    
    const langKeys = extractKeys(langData).sort();
    
    // Trouver les clés manquantes et en surplus
    const missingKeys = englishKeys.filter(key => !langKeys.includes(key));
    const extraKeys = langKeys.filter(key => !englishKeys.includes(key));
    
    const isValid = missingKeys.length === 0 && extraKeys.length === 0;
    
    if (isValid) {
      console.log(`✅ ${lang}: Toutes les clés sont présentes (${langKeys.length} clés)`);
      results.push({ lang, status: 'valid', missingKeys: [], extraKeys: [] });
    } else {
      console.log(`❌ ${lang}: Problèmes détectés`);
      
      if (missingKeys.length > 0) {
        console.log(`   📝 ${missingKeys.length} clés manquantes:`);
        missingKeys.forEach(key => console.log(`      - ${key}`));
      }
      
      if (extraKeys.length > 0) {
        console.log(`   ➕ ${extraKeys.length} clés en surplus:`);
        extraKeys.forEach(key => console.log(`      + ${key}`));
      }
      
      results.push({ lang, status: 'invalid', missingKeys, extraKeys });
      allLanguagesValid = false;
    }
    
    console.log('');
  }
  
  // Résumé final
  console.log('\n' + '='.repeat(60));
  console.log('📊 RÉSUMÉ FINAL');
  console.log('='.repeat(60));
  
  const validLanguages = results.filter(r => r.status === 'valid').length;
  const totalLanguages = results.length;
  
  console.log(`✅ Langues valides: ${validLanguages}/${totalLanguages}`);
  
  if (allLanguagesValid) {
    console.log('🎉 Toutes les traductions sont cohérentes!');
  } else {
    console.log('⚠️  Des problèmes ont été détectés dans certaines traductions.');
    
    // Détail des problèmes
    const problemLanguages = results.filter(r => r.status !== 'valid');
    console.log(`\n🔍 Langues avec des problèmes (${problemLanguages.length}):`);
    
    problemLanguages.forEach(result => {
      const { lang, status, missingKeys, extraKeys } = result;
      
      if (status === 'missing_file') {
        console.log(`   ${lang}: Fichier manquant`);
      } else if (status === 'read_error') {
        console.log(`   ${lang}: Erreur de lecture`);
      } else {
        const issues = [];
        if (missingKeys.length > 0) issues.push(`${missingKeys.length} manquantes`);
        if (extraKeys.length > 0) issues.push(`${extraKeys.length} en surplus`);
        console.log(`   ${lang}: ${issues.join(', ')}`);
      }
    });
  }
  
  return allLanguagesValid;
}

// Exécuter la vérification
if (require.main === module) {
  checkTranslations();
}

module.exports = { checkTranslations, extractKeys };