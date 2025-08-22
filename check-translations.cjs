const fs = require('fs');
const path = require('path');

// Function to recursively extract all keys from a JSON object
function extractKeys(obj, prefix = '') {
  const keys = [];
  
  for (const key in obj) {
    if (obj.hasOwnProperty(key)) {
      const fullKey = prefix ? `${prefix}.${key}` : key;
      
      if (typeof obj[key] === 'object' && obj[key] !== null && !Array.isArray(obj[key])) {
        // Recursion for nested objects
        keys.push(...extractKeys(obj[key], fullKey));
      } else {
        // Final key (primitive value)
        keys.push(fullKey);
      }
    }
  }
  
  return keys;
}

// Function to read and parse a JSON file
function readTranslationFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    console.error(`Error reading ${filePath}:`, error.message);
    return null;
  }
}

// Main function
function checkTranslations() {
  const localesDir = path.join(__dirname, 'public', 'locales');
  const englishFile = path.join(localesDir, 'en', 'translation.json');
  
  // Read the reference file (English)
  console.log('📖 Reading reference file (English)...');
  const englishData = readTranslationFile(englishFile);
  
  if (!englishData) {
    console.error('❌ Unable to read the English reference file');
    return;
  }
  
  // Extract all keys from the English file
  const englishKeys = extractKeys(englishData).sort();
  console.log(`✅ ${englishKeys.length} keys found in the English file\n`);
  
  // Read all language directories
  const languageDirs = fs.readdirSync(localesDir, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => dirent.name)
    .filter(lang => lang !== 'en'); // Exclude English
  
  console.log(`🌍 Languages to check: ${languageDirs.join(', ')}\n`);
  
  let allLanguagesValid = true;
  const results = [];
  
  // Check each language
  for (const lang of languageDirs) {
    const langFile = path.join(localesDir, lang, 'translation.json');
    
    if (!fs.existsSync(langFile)) {
      console.log(`⚠️  ${lang}: Missing translation.json file`);
      results.push({ lang, status: 'missing_file', missingKeys: [], extraKeys: [] });
      allLanguagesValid = false;
      continue;
    }
    
    const langData = readTranslationFile(langFile);
    
    if (!langData) {
      console.log(`❌ ${lang}: Error reading file`);
      results.push({ lang, status: 'read_error', missingKeys: [], extraKeys: [] });
      allLanguagesValid = false;
      continue;
    }
    
    const langKeys = extractKeys(langData).sort();
    
    // Find missing and extra keys
    const missingKeys = englishKeys.filter(key => !langKeys.includes(key));
    const extraKeys = langKeys.filter(key => !englishKeys.includes(key));
    
    const isValid = missingKeys.length === 0 && extraKeys.length === 0;
    
    if (isValid) {
      console.log(`✅ ${lang}: All keys are present (${langKeys.length} keys)`);
      results.push({ lang, status: 'valid', missingKeys: [], extraKeys: [] });
    } else {
      console.log(`❌ ${lang}: Issues detected`);
      
      if (missingKeys.length > 0) {
        console.log(`   📝 ${missingKeys.length} missing keys:`);
        missingKeys.forEach(key => console.log(`      - ${key}`));
      }
      
      if (extraKeys.length > 0) {
        console.log(`   ➕ ${extraKeys.length} extra keys:`);
        extraKeys.forEach(key => console.log(`      + ${key}`));
      }
      
      results.push({ lang, status: 'invalid', missingKeys, extraKeys });
      allLanguagesValid = false;
    }
    
    console.log('');
  }
  
  // Final summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 FINAL SUMMARY');
  console.log('='.repeat(60));
  
  const validLanguages = results.filter(r => r.status === 'valid').length;
  const totalLanguages = results.length;
  
  console.log(`✅ Valid languages: ${validLanguages}/${totalLanguages}`);
  
  if (allLanguagesValid) {
    console.log('🎉 All translations are consistent!');
  } else {
    console.log('⚠️  Some issues were detected in the translations.');
    
    // Detail of problems
    const problemLanguages = results.filter(r => r.status !== 'valid');
    console.log(`\n🔍 Languages with issues (${problemLanguages.length}):`);
    
    problemLanguages.forEach(result => {
      const { lang, status, missingKeys, extraKeys } = result;
      
      if (status === 'missing_file') {
        console.log(`   ${lang}: Missing file`);
      } else if (status === 'read_error') {
        console.log(`   ${lang}: Read error`);
      } else {
        const issues = [];
        if (missingKeys.length > 0) issues.push(`${missingKeys.length} missing`);
        if (extraKeys.length > 0) issues.push(`${extraKeys.length} extra`);
        console.log(`   ${lang}: ${issues.join(', ')}`);
      }
    });
  }
  
  return allLanguagesValid;
}

// Run the check
if (require.main === module) {
  checkTranslations();
}

module.exports = { checkTranslations, extractKeys };
