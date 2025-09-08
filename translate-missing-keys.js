const fs = require('fs');
const path = require('path');

// Traductions pour les nouvelles clés
const translations = {
  en: {
    share: {
      title: "Share NoNetChat",
      subtitle: "Invite your friends to discover NoNetChat Web",
      description: "Secure and geolocated hyperlocal P2P messaging",
      native: "Share",
      email: "Email",
      copy_link: "Or copy the link",
      copy: "Copy",
      copied: "Copied"
    },
    settings: {
      world: "Entire world"
    }
  },
  de: {
    share: {
      title: "NoNetChat teilen",
      subtitle: "Laden Sie Ihre Freunde ein, NoNetChat Web zu entdecken",
      description: "Sichere und geolokalisierte hyperlokale P2P-Nachrichten",
      native: "Teilen",
      email: "E-Mail",
      copy_link: "Oder Link kopieren",
      copy: "Kopieren",
      copied: "Kopiert"
    },
    settings: {
      world: "Ganze Welt"
    }
  },
  es: {
    share: {
      title: "Compartir NoNetChat",
      subtitle: "Invita a tus amigos a descubrir NoNetChat Web",
      description: "Mensajería P2P hiperlocal segura y geolocalizada",
      native: "Compartir",
      email: "Correo electrónico",
      copy_link: "O copiar el enlace",
      copy: "Copiar",
      copied: "Copiado"
    },
    settings: {
      world: "Mundo entero"
    }
  },
  it: {
    share: {
      title: "Condividi NoNetChat",
      subtitle: "Invita i tuoi amici a scoprire NoNetChat Web",
      description: "Messaggistica P2P iperlocale sicura e geolocalizzata",
      native: "Condividi",
      email: "Email",
      copy_link: "O copia il link",
      copy: "Copia",
      copied: "Copiato"
    },
    settings: {
      world: "Mondo intero"
    }
  },
  pt: {
    share: {
      title: "Compartilhar NoNetChat",
      subtitle: "Convide seus amigos para descobrir o NoNetChat Web",
      description: "Mensagens P2P hiperlocais seguras e geolocalizadas",
      native: "Compartilhar",
      email: "Email",
      copy_link: "Ou copie o link",
      copy: "Copiar",
      copied: "Copiado"
    },
    settings: {
      world: "Mundo inteiro"
    }
  },
  nl: {
    share: {
      title: "NoNetChat delen",
      subtitle: "Nodig je vrienden uit om NoNetChat Web te ontdekken",
      description: "Veilige en geogelokaliseerde hyperlokale P2P-berichten",
      native: "Delen",
      email: "E-mail",
      copy_link: "Of kopieer de link",
      copy: "Kopiëren",
      copied: "Gekopieerd"
    },
    settings: {
      world: "Hele wereld"
    }
  },
  ru: {
    share: {
      title: "Поделиться NoNetChat",
      subtitle: "Пригласите друзей открыть NoNetChat Web",
      description: "Безопасные и геолокализованные гиперлокальные P2P-сообщения",
      native: "Поделиться",
      email: "Электронная почта",
      copy_link: "Или скопируйте ссылку",
      copy: "Копировать",
      copied: "Скопировано"
    },
    settings: {
      world: "Весь мир"
    }
  },
  zh: {
    share: {
      title: "分享 NoNetChat",
      subtitle: "邀请您的朋友发现 NoNetChat Web",
      description: "安全且地理定位的超本地 P2P 消息传递",
      native: "分享",
      email: "电子邮件",
      copy_link: "或复制链接",
      copy: "复制",
      copied: "已复制"
    },
    settings: {
      world: "整个世界"
    }
  },
  ja: {
    share: {
      title: "NoNetChatを共有",
      subtitle: "友達をNoNetChat Webに招待しましょう",
      description: "安全で地理的位置情報に基づくハイパーローカルP2Pメッセージング",
      native: "共有",
      email: "メール",
      copy_link: "またはリンクをコピー",
      copy: "コピー",
      copied: "コピーしました"
    },
    settings: {
      world: "全世界"
    }
  },
  ko: {
    share: {
      title: "NoNetChat 공유",
      subtitle: "친구들을 NoNetChat Web에 초대하세요",
      description: "안전하고 지리적으로 위치한 하이퍼로컬 P2P 메시징",
      native: "공유",
      email: "이메일",
      copy_link: "또는 링크 복사",
      copy: "복사",
      copied: "복사됨"
    },
    settings: {
      world: "전 세계"
    }
  },
  ar: {
    share: {
      title: "مشاركة NoNetChat",
      subtitle: "ادع أصدقاءك لاكتشاف NoNetChat Web",
      description: "رسائل P2P محلية آمنة ومحددة الموقع جغرافياً",
      native: "مشاركة",
      email: "البريد الإلكتروني",
      copy_link: "أو انسخ الرابط",
      copy: "نسخ",
      copied: "تم النسخ"
    },
    settings: {
      world: "العالم كله"
    }
  },
  hi: {
    share: {
      title: "NoNetChat साझा करें",
      subtitle: "अपने दोस्तों को NoNetChat Web खोजने के लिए आमंत्रित करें",
      description: "सुरक्षित और भू-स्थित हाइपरलोकल P2P संदेश",
      native: "साझा करें",
      email: "ईमेल",
      copy_link: "या लिंक कॉपी करें",
      copy: "कॉपी करें",
      copied: "कॉपी किया गया"
    },
    settings: {
      world: "पूरी दुनिया"
    }
  }
};

// Langues avec traductions de base (utilisant l'anglais comme fallback)
const basicLanguages = ['bn', 'id', 'mr', 'pa', 'pl', 'ro', 'sw', 'ta', 'te', 'tr', 'ur', 'zh-CN', 'zh-TW'];

function updateTranslationFile(lang) {
  const filePath = path.join(__dirname, 'public', 'locales', lang, 'translation.json');
  
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    
    // Utiliser les traductions spécifiques ou l'anglais comme fallback
    const langTranslations = translations[lang] || translations.en;
    
    // Mettre à jour les traductions
    if (data.share) {
      Object.assign(data.share, langTranslations.share);
    }
    
    if (data.settings) {
      Object.assign(data.settings, langTranslations.settings);
    }
    
    // Sauvegarder le fichier
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
    console.log(`✅ ${lang}: Traductions mises à jour`);
    
  } catch (error) {
    console.error(`❌ Erreur pour ${lang}:`, error.message);
  }
}

function main() {
  const localesDir = path.join(__dirname, 'public', 'locales');
  const languages = fs.readdirSync(localesDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name)
    .filter(lang => lang !== 'fr'); // Exclure le français (déjà correct)
  
  console.log(`🌍 Mise à jour des traductions pour: ${languages.join(', ')}\n`);
  
  languages.forEach(updateTranslationFile);
  
  console.log('\n🎉 Mise à jour terminée!');
}

if (require.main === module) {
  main();
}

module.exports = { updateTranslationFile, translations };