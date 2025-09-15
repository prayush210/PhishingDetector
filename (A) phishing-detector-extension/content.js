// content.js
console.log("Phishing Detector Content Script Loaded (Full Replacement - V.FinalCheck).");

// --- Global variables ---
let tfidfVocabulary = null;
let tfidfIdfData = null;
let handcraftedFeatureNames = null;
let selectorInfo = null;

let onnxModelInputName = null;
let ortInitializationSuccessful = false;
let pageInitializerReady = false;

// --- Helper to load JSON ---
async function loadJsonArtifact(filename) {
  try {
    const url = chrome.runtime.getURL(filename);
    const response = await fetch(url);
    if (!response.ok) {
        const errorText = await response.text();
        console.error(`Fetch ${filename} failed: ${response.status} ${response.statusText}`, errorText);
        throw new Error(`Fetch ${filename} failed: ${response.status} ${response.statusText}`);
    }
    const jsonData = await response.json();
    console.log(`Successfully loaded and parsed ${filename}.`);
    return jsonData;
  } catch (error) {
    console.error(`Error loading or parsing JSON ${filename}:`, error);
    throw error;
  }
}

// --- Inject script into main page context ---
function injectScriptToPage(filePath, scriptId, dataAttributes = {}) {
  return new Promise((resolve, reject) => {
    const existingScript = document.getElementById(scriptId);
    if (existingScript) {
        console.log(`Script with id "${scriptId}" already present. Removing and re-injecting for freshness.`);
        existingScript.remove();
    }
    const scriptElement = document.createElement('script');
    scriptElement.src = chrome.runtime.getURL(filePath);
    scriptElement.id = scriptId;
    for (const key in dataAttributes) {
      scriptElement.dataset[key] = dataAttributes[key];
    }
    scriptElement.onload = () => {
      console.log(`Script "${filePath}" loaded into page (id: ${scriptId}).`);
      resolve();
    };
    scriptElement.onerror = (e) => {
      console.error(`Failed to load script "${filePath}" (id: ${scriptId}):`, e);
      reject(new Error(`Failed to load script ${filePath}.`));
    };
    (document.head || document.documentElement).appendChild(scriptElement);
  });
}

// --- Initialize Model & Artifacts ---
async function initializeModelAndArtifacts() {
  console.log("Initializing Model & Artifacts...");
  if (ortInitializationSuccessful && pageInitializerReady) {
    console.log("Model & Artifacts already reported as initialized.");
    return true;
  }
  try {
    await injectScriptToPage('js/ort.min.js', 'phishing-detector-ort-library-script');
    console.log("ort.min.js injection complete. Waiting for window.ort...");
    await new Promise(resolve => setTimeout(resolve, 700));

    const wasmDirectoryForInjection = chrome.runtime.getURL('js/');
    const modelPathForInjection = chrome.runtime.getURL('linear_svc_model.onnx');

    const mainWorldOrtSessionResponsePromise = new Promise((resolve, reject) => {
      document.addEventListener('ortMainWorldResponse', function handleEvent(event) {
        document.removeEventListener('ortMainWorldResponse', handleEvent);
        if (event.detail.success) {
          console.log("CONTENT SCRIPT: SUCCESS from main world ORT session initializer.", event.detail);
          resolve(event.detail);
        } else {
          console.error("CONTENT SCRIPT: FAILURE from main world ORT session initializer:", event.detail.error);
          reject(new Error(`Main world ORT initialization failed: ${event.detail.error}`));
        }
      }, { once: true });
    });

    const pageInitializerReadyPromise = new Promise((resolve) => {
        document.addEventListener('ortInitializerScriptReady', function handleReadyEvent(){
            console.log("CONTENT SCRIPT: 'ortInitializerScriptReady' signal received.");
            document.removeEventListener('ortInitializerScriptReady', handleReadyEvent);
            resolve();
        }, { once: true });
    });

    console.log("Injecting js/ort-page-initializer.js...");
    await injectScriptToPage('js/ort-page-initializer.js', 'phishing-detector-ort-page-initializer-script', {
        wasmDirectory: wasmDirectoryForInjection,
        modelPath: modelPathForInjection
    });

    const mainWorldResult = await mainWorldOrtSessionResponsePromise;
    await pageInitializerReadyPromise;

    onnxModelInputName = mainWorldResult.inputNames && mainWorldResult.inputNames.length > 0 ? mainWorldResult.inputNames[0] : 'float_input';
    ortInitializationSuccessful = true;
    pageInitializerReady = true;
    console.log("CONTENT SCRIPT: ONNX Runtime setup in main world success. Input name:", onnxModelInputName);

    console.log("Loading JSON artifacts...");
    const [
        loadedTfidfVocab, // Local variable from Promise.all
        loadedTfidfIdfData,
        loadedHfNames,
        loadedSelectorInfo
    ] = await Promise.all([
      loadJsonArtifact('tfidf_vocabulary.json'),
      loadJsonArtifact('tfidf_idf_data.json'),
      loadJsonArtifact('handcrafted_feature_names.json'),
      loadJsonArtifact('selector_info.json')
    ]);

    // Assign to global variables (using consistent naming)
    tfidfVocabulary = loadedTfidfVocab;         // Global: tfidfVocabulary (Capital V)
    tfidfIdfData = loadedTfidfIdfData;
    handcraftedFeatureNames = loadedHfNames;
    selectorInfo = loadedSelectorInfo;

    console.log("Validating loaded artifacts structure...");
    if (!tfidfVocabulary || typeof tfidfVocabulary !== 'object') { // Uses global tfidfVocabulary
        throw new Error("Validation Error: tfidf_vocabulary.json is missing or not an object.");
    }
    if (!tfidfIdfData || typeof tfidfIdfData !== 'object') {
        console.error("DEBUG Validation: tfidfIdfData before check:", tfidfIdfData);
        throw new Error("Validation Error: tfidf_idf_data.json is missing or not an object.");
    }
    if (!Array.isArray(tfidfIdfData.idf_weights)) {
        throw new Error("Validation Error: tfidf_idf_data.json is missing 'idf_weights' array.");
    }
    if (!Array.isArray(tfidfIdfData.ngram_range) || tfidfIdfData.ngram_range.length !== 2) {
        console.error("DEBUG Validation: tfidfIdfData.ngram_range:", tfidfIdfData.ngram_range);
        throw new Error("Validation Error: tfidf_idf_data.json is missing 'ngram_range' array of length 2 or it's not an array.");
    }
    if (typeof tfidfIdfData.sublinear_tf !== 'boolean') {
        console.error("DEBUG Validation: tfidfIdfData.sublinear_tf:", tfidfIdfData.sublinear_tf, "Type:", typeof tfidfIdfData.sublinear_tf);
        throw new Error("Validation Error: tfidf_idf_data.json is missing 'sublinear_tf' boolean or it's not a boolean.");
    }
    if (!Array.isArray(handcraftedFeatureNames)) {
        throw new Error("Validation Error: handcrafted_feature_names.json did not load as an array.");
    }

    if (!selectorInfo || typeof selectorInfo !== 'object') {
        console.error("DEBUG Validation: selectorInfo object is falsy or not an object:", selectorInfo);
        throw new Error("Validation Error: selector_info.json did not load as an object.");
    }
    if (!Array.isArray(selectorInfo.selected_indices)) {
        console.error("DEBUG Validation: selectorInfo.selected_indices is not an array:", selectorInfo.selected_indices);
        throw new Error("Validation Error: selector_info.json is missing 'selected_indices' array.");
    }
    if (typeof selectorInfo.k === 'undefined') {
        console.error("DEBUG Validation: selectorInfo.k is undefined:", selectorInfo.k);
        throw new Error("Validation Error: selector_info.json is missing 'k' property.");
    }
    if (typeof selectorInfo.total_features_before_selection !== 'number') {
        console.error("DEBUG Validation: selectorInfo.total_features_before_selection is not a number:", selectorInfo.total_features_before_selection, "Type:", typeof selectorInfo.total_features_before_selection);
        throw new Error("Validation Error: selector_info.json is missing 'total_features_before_selection' number.");
    }
    if (typeof selectorInfo.num_tfidf_features !== 'number') {
        console.error("DEBUG Validation: selectorInfo.num_tfidf_features is not a number:", selectorInfo.num_tfidf_features, "Type:", typeof selectorInfo.num_tfidf_features);
        throw new Error("Validation Error: selector_info.json is missing 'num_tfidf_features' number.");
    }
    if (typeof selectorInfo.num_manual_features !== 'number') {
        console.error("DEBUG Validation: selectorInfo.num_manual_features is not a number:", selectorInfo.num_manual_features, "Type:", typeof selectorInfo.num_manual_features);
        throw new Error("Validation Error: selector_info.json is missing 'num_manual_features' number.");
    }
    console.log("JSON artifacts loaded and validated successfully (stricter checks).");

    console.log('Model & Artifacts considered initialized.');
    return true;
  } catch (error) {
    console.error('CRITICAL: Failed to initialize Model & Artifacts:', error.stack || error);
    ortInitializationSuccessful = false;
    pageInitializerReady = false;
    return false;
  }
}
let initializationPromise = initializeModelAndArtifacts();

// --- 1. DOM Extraction Function ---
function extractEmailDataFromDOM() {
  console.log("Attempting to extract email data from DOM...");
  let extractedData = { sender: '', subject: '', bodyText: '', bodyHtml: '' };
  const subjectSelector = 'h2.hP';
  const senderSelector = 'span.gD[email]';
  const bodySelector = 'div.a3s.aiL';

  const subjectElement = document.querySelector(subjectSelector);
  extractedData.subject = subjectElement ? subjectElement.innerText.trim() : '';
  if (!subjectElement) console.warn(`Warning: Subject selector "${subjectSelector}" not found.`);

  const senderElement = document.querySelector(senderSelector);
  extractedData.sender = senderElement ? senderElement.getAttribute('email') : '';
   if (!senderElement) {
      const senderNameElement = document.querySelector('span.gD[name]');
      if(senderNameElement) extractedData.sender = senderNameElement.getAttribute('name');
      console.warn(`Warning: Sender selector "${senderSelector}" not found. Using name: ${extractedData.sender || 'N/A'}`);
  }

  const emailBodyElement = document.querySelector(bodySelector);
  if (emailBodyElement) {
    extractedData.bodyText = emailBodyElement.innerText;
    extractedData.bodyHtml = emailBodyElement.innerHTML;
  } else {
    console.warn(`Warning: Email body selector "${bodySelector}" not found.`);
  }
  if (!extractedData.bodyText && !extractedData.subject) {
    console.error('CRITICAL: Failed to extract essential email content (neither body nor subject found).');
    return null;
  }
  console.log(`Extraction: Sender: [${extractedData.sender || 'N/A'}], Subject: [${extractedData.subject ? extractedData.subject.substring(0,30) + '...' : 'N/A'}]`);
  return extractedData;
}


// --- Text Cleaning ---
function cleanTextForTfidf(text) {
  if (typeof text !== 'string') {
    console.warn("cleanTextForTfidf received non-string input, returning empty string.");
    return "";
  }
  let cleaned = text.toLowerCase();
  cleaned = cleaned.replace(/<[^>]+>/g, ' ');
  cleaned = cleaned.replace(/&[a-z0-9#]+;/gi, ' ');
  cleaned = cleaned.replace(/\b(x{3,}|\.{3,}|-{3,})\b/g, ' ');
  cleaned = cleaned.replace(/https?:\/\/\S+/gi, '');
  cleaned = cleaned.replace(/\S+@\S+/g, '');
  cleaned = cleaned.replace(/[0-9]+/g, '');
  cleaned = cleaned.replace(/[!"#$%&'()*+,-./:;<=>?@[\\\]^_`{|}~]/g, ' ');
  cleaned = cleaned.replace(/\b\w{1,2}\b/g, '');
  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  return cleaned;
}

// --- 2. Handcrafted Feature Extraction ---
function extractHandcraftedFeatures(emailData, cleanedTextForFeatures) {
  console.log('Extracting handcrafted features...');
  const features = {};
  const fullRawText = `${emailData.subject} ${emailData.bodyText}`;
  const originalTextWithHtml = `${emailData.subject} ${emailData.bodyHtml}`;
  const tempDiv = document.createElement('div');
  tempDiv.innerHTML = emailData.bodyHtml;
  const linksInEmail = tempDiv.querySelectorAll('a');

  const wordsForCount = cleanedTextForFeatures.split(/\s+/).filter(Boolean);
  features['word_count'] = wordsForCount.length;
  features['char_count'] = cleanedTextForFeatures.length;
  const sentenceTerminators = cleanedTextForFeatures.match(/[.!?]+/g);
  features['sentence_count'] = sentenceTerminators ? sentenceTerminators.length : (cleanedTextForFeatures.length > 0 ? 1 : 0);
  if (cleanedTextForFeatures.trim() === '') features['sentence_count'] = 0;
  features['avg_word_length'] = wordsForCount.length > 0 ? wordsForCount.reduce((sum, word) => sum + word.length, 0) / wordsForCount.length : 0;
  features['avg_sentence_length'] = features['sentence_count'] > 0 ? features['word_count'] / features['sentence_count'] : 0;
  const allLinesInBody = emailData.bodyText.split('\n');
  const forwardedLinesCount = allLinesInBody.filter(line => line.trim().startsWith('>')).length;
  features['forwarded_line_ratio'] = allLinesInBody.length > 0 ? forwardedLinesCount / allLinesInBody.length : 0;
  let shortSentences = 0;
  if (features['sentence_count'] > 0) {
    const roughSentences = cleanedTextForFeatures.split(/[.!?]+/g).filter(s => s.trim().length > 0);
    roughSentences.forEach(s => { if (s.split(/\s+/).filter(Boolean).length < 5) shortSentences++; });
    features['short_sentence_ratio'] = features['sentence_count'] > 0 ? shortSentences / features['sentence_count'] : 0;
  } else { features['short_sentence_ratio'] = 0; }

  features['num_links'] = linksInEmail.length;
  let hasIpUrl = 0, hasShortenedUrl = 0, mismatches = 0, suspiciousDomainsInLink = 0, urlEncodingInLinks = 0, unicodeInLinks = 0;
  linksInEmail.forEach(link => {
    const href = link.getAttribute('href');
    if (href) {
      if (/https?:\/\/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/.test(href)) hasIpUrl = 1;
      if (/(bit\.ly|goo\.gl|tinyurl|t\.co|is\.gd|ow\.ly|buff\.ly)/i.test(href)) hasShortenedUrl = 1;
      const linkText = link.innerText.trim().toLowerCase();
      const hrefLower = href.toLowerCase();
      const simplifiedLinkText = linkText.replace(/^(https?:\/\/)?(www\.)?/, '');
      const simplifiedHref = hrefLower.replace(/^(https?:\/\/)?(www\.)?/, '');
      if (/^(https?:\/\/|www\.)/.test(linkText) && simplifiedLinkText !== simplifiedHref && !simplifiedHref.startsWith(simplifiedLinkText)) mismatches++;
      try {
        const domain = new URL(href).hostname;
        if (/(secure|login|verify|account|billing|password|confirm|support|service)/i.test(domain)) suspiciousDomainsInLink++;
      } catch (e) {
        const domainMatch = hrefLower.match(/https?:\/\/(?:www\.)?([^/]+)/);
        if (domainMatch && domainMatch[1] && /(secure|login|verify|account|billing|password|confirm|support|service)/i.test(domainMatch[1])) suspiciousDomainsInLink++;
      }
      if (/%[0-9A-Fa-f]{2}/.test(href)) urlEncodingInLinks = 1;
      if (/\\u[0-9a-fA-F]{4}/.test(href)) unicodeInLinks = 1;
    }
  });
  features['has_ip_url'] = hasIpUrl; features['has_shortened_url'] = hasShortenedUrl; features['link_text_url_mismatch'] = mismatches; features['suspicious_domain_keyword_count'] = suspiciousDomainsInLink;
  features['has_url_encoding'] = /%[0-9A-Fa-f]{2}/.test(originalTextWithHtml) ? 1 : urlEncodingInLinks;
  features['has_unicode_in_url'] = /\\u[0-9a-fA-F]{4}/.test(originalTextWithHtml) ? 1 : unicodeInLinks;
  features['deceptive_url_pattern'] = ( /paypal[^\s]*\.com(?!\.paypal\.com)/i.test(originalTextWithHtml) || /apple[^\s]*\.com(?!\.apple\.com)/i.test(originalTextWithHtml) || /google[^\s]*\.com(?!\.google\.com)/i.test(originalTextWithHtml) ) ? 1 : 0;
  features['domain_mismatch'] = features['link_text_url_mismatch'] > 0 ? 1 : 0;

  let senderDomain = '';
  if (emailData.sender) { const atMatch = emailData.sender.match(/@([\w\.-]+\.\w+)/); if (atMatch && atMatch[1]) senderDomain = atMatch[1].toLowerCase(); }
  features['sender_is_free_domain'] = senderDomain ? (/(gmail|googlemail|hotmail|outlook|yahoo|aol)\./i.test(senderDomain) ? 1 : 0) : 0;
  features['sender_claims_major_brand'] = senderDomain ? (/(paypal|apple|google|microsoft|amazon|netflix|facebook|bank|chase|wells\s*fargo|irs|gov)/i.test(senderDomain) ? 1 : 0) : 0;
  features['has_mismatched_sender_replyto'] = /from:[\s\S]*@([\w.-]+\.\w+)[\s\S]*reply-to:[\s\S]*@(?!\1)[\w.-]+\.\w+/i.test(originalTextWithHtml) ? 1 : 0;
  features['has_reply_to'] = /^reply-to:/im.test(originalTextWithHtml) ? 1 : 0;
  features['multiple_from_fields'] = (originalTextWithHtml.match(/^from:/gim) || []).length > 1 ? 1 : 0;
  features['suspicious_cc_bcc'] = /^(cc|bcc):[\s\S]*undisclosed/im.test(originalTextWithHtml) ? 1 : 0;

  const phishingKeywordsList = [ 'verify', 'account', 'suspended', 'locked', 'urgent', 'immediately', 'action required', 'password', 'login', 'signin', 'security', 'update', 'click', 'link', 'confirm', 'validate', 'ssn', 'social security', 'credit card', 'bank', 'statement', 'invoice', 'payment', 'alert', 'unusual', 'problem', 'issue', 'expire', 'limited', 'offer', 'winner', 'prize', 'confidential', 'important', 'warning', 'fraud', 'access', 'restricted', 'failed', 'unable', 'due', 'overdue', 'risk'];
  let phishingKeywordCount = 0;
  const lowerCaseCleanedText = cleanedTextForFeatures.toLowerCase();
  phishingKeywordsList.forEach(kw => { const regex = new RegExp(`\\b${kw}\\b`, 'gi'); const matches = lowerCaseCleanedText.match(regex); if (matches) phishingKeywordCount += matches.length; });
  features['phishing_keyword_count'] = phishingKeywordCount;
  features['has_urgent_phrase'] = /\b(urgent|immediately|asap|now|important|alert|action required|limited time)\b/i.test(cleanedTextForFeatures) ? 1 : 0;
  features['has_attachment_mention'] = /\b(attachment|attached|document|file|report|invoice)\b/i.test(cleanedTextForFeatures) ? 1 : 0;
  features['has_generic_greeting'] = /\b(dear|hello)\s+(customer|user|member|valued|client|subscriber)\b/i.test(cleanedTextForFeatures) ? 1 : 0;
  features['has_threat_language'] = /\b(suspend|terminate|cancel|close|delete|remove|lock|disable)[\s\S]*(account|access)\b/i.test(cleanedTextForFeatures) ? 1 : 0;
  features['has_financial_request'] = /\b(payment|invoice|transfer|wire|bank|credit card|ssn|tax id)\b/i.test(cleanedTextForFeatures) ? 1 : 0;

  features['html_content_ratio'] = emailData.bodyHtml.length > 0 ? (emailData.bodyHtml.match(/<[^>]+>/g) || []).length / emailData.bodyHtml.length : 0;
  features['has_forms'] = tempDiv.querySelectorAll('form').length > 0 ? 1 : 0; features['has_button_tag'] = tempDiv.querySelectorAll('button').length > 0 ? 1 : 0; features['input_field_count'] = tempDiv.querySelectorAll('input').length; features['iframe_count'] = tempDiv.querySelectorAll('iframe').length;
  features['hidden_element_count'] = (originalTextWithHtml.match(/style\s*=\s*["'][^"']*(display:\s*none|visibility:\s*hidden)/gi) || []).length;
  features['div_count'] = tempDiv.querySelectorAll('div').length;
  let suspiciousFormAction = 0; tempDiv.querySelectorAll('form').forEach(form => { const action = form.getAttribute('action'); if (action && !/^(#|\/|mailto:)/i.test(action) && !/https?:\/\/([\w-]+\.)*(paypal|google|apple|amazon|microsoft|facebook)\.com/i.test(action)) suspiciousFormAction = 1; }); features['suspicious_form_action'] = suspiciousFormAction;
  let externalFormSubmission = 0; tempDiv.querySelectorAll('form').forEach(form => { if (form.getAttribute('action') && /^https?:\/\//i.test(form.getAttribute('action'))) externalFormSubmission = 1; }); features['external_form_submission'] = externalFormSubmission;
  features['form_with_password_field'] = tempDiv.querySelectorAll('form input[type="password"]').length > 0 ? 1 : 0; features['has_script_tag'] = tempDiv.querySelectorAll('script').length > 0 ? 1 : 0; features['script_tag_count'] = tempDiv.querySelectorAll('script').length;
  features['event_handler_count'] = (originalTextWithHtml.match(/on(click|load|mouseover|submit|focus|blur|change|keyup|keydown)\s*=/gi) || []).length;
  features['has_eval_pattern'] = /eval\s*\(/i.test(originalTextWithHtml) ? 1 : 0; features['has_document_write'] = /document\.write/i.test(originalTextWithHtml) ? 1 : 0; features['has_window_open'] = /window\.open/i.test(originalTextWithHtml) ? 1 : 0;
  features['has_settimeout_interval'] = /(setTimeout|setInterval)/i.test(originalTextWithHtml) ? 1 : 0;
  features['has_js_obfuscation'] = /(\\x[0-9a-f]{2})|(\\u[0-9a-f]{4})|String\.fromCharCode|unescape|encodeURIComponent/i.test(originalTextWithHtml) ? 1 : 0;

  features['exclamation_mark_count'] = (fullRawText.match(/!/g) || []).length; features['question_mark_count'] = (fullRawText.match(/\?/g) || []).length;
  let upperCaseChars = 0; for (let i = 0; i < fullRawText.length; i++) { if (fullRawText[i] >= 'A' && fullRawText[i] <= 'Z') upperCaseChars++; } features['all_caps_char_ratio'] = fullRawText.length > 0 ? upperCaseChars / fullRawText.length : 0;

  let hasLinkStyleManipulation = 0; linksInEmail.forEach(link => { if (link.getAttribute('style') && /(color|text-decoration)/i.test(link.getAttribute('style'))) hasLinkStyleManipulation = 1; }); features['has_link_style_manipulation'] = hasLinkStyleManipulation;
  features['has_favicon_link'] = tempDiv.querySelectorAll('link[rel~="icon"]').length > 0 ? 1 : 0;
  let hasFakeSecurityImage = 0; tempDiv.querySelectorAll('img').forEach(img => { const src = img.getAttribute('src'); if (src && /(lock|secure|verify|ssl|trust|shield|badge|cert)[\s\S]*\.(png|gif|jpg|jpeg)/i.test(src)) hasFakeSecurityImage = 1; }); features['has_fake_security_image'] = hasFakeSecurityImage;
  features['has_status_bar_manipulation'] = /(window\.status|onmouseover\s*=\s*["']window\.status)/i.test(originalTextWithHtml) ? 1 : 0;
  features['visual_deception_score'] = features['has_fake_security_image'] + features['has_link_style_manipulation'] + features['has_status_bar_manipulation'];

  if (handcraftedFeatureNames && Array.isArray(handcraftedFeatureNames)) {
    handcraftedFeatureNames.forEach(name => { if (!(name in features)) features[name] = 0; });
  }
  for (const key in features) {
    if (typeof features[key] === 'boolean') features[key] = features[key] ? 1 : 0;
    else if (features[key] == null || Number.isNaN(features[key])) features[key] = 0;
    else if (typeof features[key] !== 'number') { const numVal = parseFloat(features[key]); features[key] = Number.isNaN(numVal) ? 0 : numVal; }
  }
  console.log(`Handcrafted features. Count: ${Object.keys(features).length}`, features);
  return features;
}

// --- 3. TF-IDF Feature Extraction ---
function extractTfidfFeatures(cleanedText) {
  console.log("Extracting TF-IDF features...");

  if (!tfidfVocabulary) console.error("DEBUG TF-IDF: tfidfVocabulary is falsy/null at function start.", tfidfVocabulary); // Uses global tfidfVocabulary
  if (tfidfVocabulary && typeof tfidfVocabulary !== 'object') console.error("DEBUG TF-IDF: tfidfVocabulary is not an object at function start. Type:", typeof tfidfVocabulary);
  if (!tfidfIdfData) console.error("DEBUG TF-IDF: tfidfIdfData is falsy/null at function start.", tfidfIdfData);
  if (tfidfIdfData && typeof tfidfIdfData !== 'object') console.error("DEBUG TF-IDF: tfidfIdfData is not an object at function start. Type:", typeof tfidfIdfData);
  if (tfidfIdfData && !Array.isArray(tfidfIdfData.idf_weights)) console.error("DEBUG TF-IDF: tfidfIdfData.idf_weights is not an array at function start. Value:", tfidfIdfData.idf_weights);
  if (tfidfIdfData && !Array.isArray(tfidfIdfData.ngram_range)) console.error("DEBUG TF-IDF: tfidfIdfData.ngram_range is not an array at function start. Value:", tfidfIdfData.ngram_range);
  if (tfidfIdfData && typeof tfidfIdfData.sublinear_tf !== 'boolean') {
      console.error("DEBUG TF-IDF: tfidfIdfData.sublinear_tf is not a boolean at function start. Value:", tfidfIdfData.sublinear_tf, "Type:", typeof tfidfIdfData.sublinear_tf);
  }

  if (!tfidfVocabulary || typeof tfidfVocabulary !== 'object' || // Uses global tfidfVocabulary
      !tfidfIdfData || typeof tfidfIdfData !== 'object' ||
      !Array.isArray(tfidfIdfData.idf_weights) ||
      !Array.isArray(tfidfIdfData.ngram_range) || tfidfIdfData.ngram_range.length !== 2 ||
      typeof tfidfIdfData.sublinear_tf !== 'boolean') {
    console.error("TF-IDF global parameters (tfidfVocabulary, tfidfIdfData.idf_weights, tfidfIdfData.ngram_range, tfidfIdfData.sublinear_tf) not loaded properly or have incorrect types/structure.");
    throw new Error("TF-IDF data not ready.");
  }

  const vocabulary = tfidfVocabulary; // Uses global tfidfVocabulary
  const idfWeights = tfidfIdfData.idf_weights;
  const ngramRange = tfidfIdfData.ngram_range;
  const sublinearTf = tfidfIdfData.sublinear_tf;

  const tfidfFeaturesSparse = {};

  const tokens = cleanedText.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) {
    console.warn("No tokens found in cleaned text for TF-IDF.");
    return tfidfFeaturesSparse;
  }

  const ngramsToCount = [];
  for (let n = ngramRange[0]; n <= ngramRange[1]; n++) {
    if (n < 1) continue;
    for (let i = 0; i <= tokens.length - n; i++) {
      ngramsToCount.push(tokens.slice(i, i + n).join(' '));
    }
  }

  if (ngramsToCount.length === 0) {
    console.warn("No n-grams generated based on ngram_range for TF-IDF.");
    return tfidfFeaturesSparse;
  }

  const termCounts = {};
  ngramsToCount.forEach(ngram => {
    termCounts[ngram] = (termCounts[ngram] || 0) + 1;
  });

  for (const term in termCounts) {
    if (vocabulary.hasOwnProperty(term)) {
      const termIndexInVocab = vocabulary[term];
      if (typeof termIndexInVocab === 'number' && termIndexInVocab >= 0 && termIndexInVocab < idfWeights.length) {
        const idf = idfWeights[termIndexInVocab];
        let tf = termCounts[term];
        if (sublinearTf && tf > 0) {
          tf = 1 + Math.log(tf);
        }
        tfidfFeaturesSparse[termIndexInVocab.toString()] = tf * idf;
      } else {
         console.warn(`TF-IDF: Term "${term}" has vocab index ${termIndexInVocab} which is out of bounds or invalid for idf_weights (length ${idfWeights.length})`);
      }
    }
  }
  console.log(`TF-IDF features generated. Non-zero count: ${Object.keys(tfidfFeaturesSparse).length}`);
  return tfidfFeaturesSparse;
}

// --- 4. Vectorize Handcrafted Features ---
function vectorizeHandcraftedFeatures(handcraftedFeaturesObject) {
  console.log("Vectorizing handcrafted features...");
  if (!handcraftedFeatureNames || !Array.isArray(handcraftedFeatureNames) || handcraftedFeatureNames.length === 0) {
    console.error("Global handcraftedFeatureNames not loaded or empty.");
    throw new Error("Handcrafted feature names list required for vectorization.");
  }
  const featureVector = new Float32Array(handcraftedFeatureNames.length);
  handcraftedFeatureNames.forEach((name, index) => {
    let value = handcraftedFeaturesObject.hasOwnProperty(name) ? handcraftedFeaturesObject[name] : 0;
    if (typeof value !== 'number' || Number.isNaN(value)) value = 0;
    featureVector[index] = value;
  });
  console.log(`Vectorized handcrafted features. Length: ${featureVector.length}.`);
  return featureVector;
}

// --- 5. Combine Features ---
function combineFeatures(tfidfSparseVector, handcraftedNumericVector) {
  console.log("Combining features...");
  if (!selectorInfo ||
      typeof selectorInfo.total_features_before_selection !== 'number' ||
      typeof selectorInfo.num_tfidf_features !== 'number' ||
      typeof selectorInfo.num_manual_features !== 'number') {
    console.error("Selector info is not loaded or is missing required numeric properties. Current selectorInfo:", selectorInfo);
    throw new Error("Selector info required for combining features is incomplete or invalid.");
  }

  const numTfidfFeatures = selectorInfo.num_tfidf_features;
  const numManualFeatures = selectorInfo.num_manual_features;

  if (numTfidfFeatures + numManualFeatures !== selectorInfo.total_features_before_selection) {
    console.warn(`Feature count mismatch during combination: num_tfidf (${numTfidfFeatures}) + num_manual (${numManualFeatures}) !== total_before_selection (${selectorInfo.total_features_before_selection}).`);
  }
  if (handcraftedNumericVector.length !== numManualFeatures) {
    console.error(`Handcrafted vector length (${handcraftedNumericVector.length}) != num_manual_features (${numManualFeatures}).`);
    throw new Error("Handcrafted feature vector length mismatch.");
  }

  const combinedVector = new Float32Array(selectorInfo.total_features_before_selection).fill(0);

  for (const indexStr in tfidfSparseVector) {
    if (tfidfSparseVector.hasOwnProperty(indexStr)) {
      const vocabIndex = parseInt(indexStr, 10);
      if (vocabIndex >= 0 && vocabIndex < numTfidfFeatures) {
        combinedVector[vocabIndex] = tfidfSparseVector[indexStr];
      } else {
        console.warn(`TF-IDF vocab index ${vocabIndex} out of expected range (0 to ${numTfidfFeatures - 1}).`);
      }
    }
  }
  combinedVector.set(handcraftedNumericVector, numTfidfFeatures);

  console.log(`Combined feature vector. Length: ${combinedVector.length}.`);
  return combinedVector;
}

// --- 6. Select K-Best Features ---
function selectKBestFeatures(combinedFullFeatureVector) {
  console.log("Applying SelectKBest...");
  if (!selectorInfo || !Array.isArray(selectorInfo.selected_indices) || typeof selectorInfo.k === 'undefined') {
    console.error("Selector info (selected_indices or k) not loaded or invalid.");
    throw new Error("Selector info required for K-Best selection.");
  }

  const selectedIndices = selectorInfo.selected_indices;
  const kValue = selectorInfo.k;

  if (kValue === 'all') {
      console.log("SelectKBest: 'k' is 'all', returning combined vector.");
      if (combinedFullFeatureVector.length !== selectorInfo.total_features_before_selection) {
          console.warn(`SelectKBest 'all': vector length ${combinedFullFeatureVector.length} != total_features_before_selection ${selectorInfo.total_features_before_selection}`);
      }
      return combinedFullFeatureVector;
  }
  if (typeof kValue !== 'number') {
      console.error(`SelectKBest: Invalid k value: ${kValue}. Expected a number or 'all'.`);
      throw new Error("Invalid k value for feature selection.");
  }
  if (selectedIndices.length !== kValue) {
      console.warn(`SelectKBest: Mismatch k (${kValue}) and selected_indices length (${selectedIndices.length}).`);
  }

  const finalFeatureVector = new Float32Array(selectedIndices.length);
  for (let i = 0; i < selectedIndices.length; i++) {
    const originalIndex = selectedIndices[i];
    if (typeof originalIndex !== 'number' || originalIndex < 0 || originalIndex >= combinedFullFeatureVector.length) {
      console.warn(`SelectKBest: Original index ${originalIndex} (at selected_indices[${i}]) is invalid or out of bounds. Defaulting to 0.`);
      finalFeatureVector[i] = 0;
    } else {
      finalFeatureVector[i] = combinedFullFeatureVector[originalIndex];
    }
  }
  console.log(`Final feature vector after SelectKBest. Length: ${finalFeatureVector.length}.`);
  return finalFeatureVector;
}

// --- 7. Get Prediction via Bridge ---
async function getPredictionViaBridge(featureVectorArray) {
  console.log("CONTENT SCRIPT: Getting prediction via main world bridge...");
  if (!onnxModelInputName) {
    console.error("CONTENT SCRIPT: ONNX Model input name unknown.");
    throw new Error("Model input name unavailable for prediction bridge.");
  }
  if (!pageInitializerReady) {
      console.error("CONTENT SCRIPT: Inference bridge to main world not ready.");
      throw new Error("Main world inference bridge not ready.");
  }

  return new Promise((resolve, reject) => {
    const requestId = `phishingDetectorPrediction_${Date.now()}_${Math.random().toString(36).substring(2)}`;
    document.addEventListener('ortPredictionResponse', function handlePredictionEvent(event) {
      if (event.detail.requestId === requestId) {
        document.removeEventListener('ortPredictionResponse', handlePredictionEvent);
        if (event.detail.success) {
          console.log("CONTENT SCRIPT: Prediction from main world:", event.detail.prediction);
          resolve(event.detail.prediction);
        } else {
          console.error("CONTENT SCRIPT: Prediction error from main world:", event.detail.error);
          reject(new Error(`Prediction failed in main world: ${event.detail.error}`));
        }
      }
    }, { once: true });

    console.log(`CONTENT SCRIPT: Dispatching 'runOrtInferenceRequest'. Input: ${onnxModelInputName}, Features length: ${featureVectorArray.length}`);
    document.dispatchEvent(new CustomEvent('runOrtInferenceRequest', {
      detail: {
        requestId: requestId,
        features: Array.from(featureVectorArray),
        inputName: onnxModelInputName
      }
    }));
  });
}

// --- Main Message Listener ---
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "scanEmail") {
    console.log('Received scanEmail request from popup.');
    const doScan = async () => {
      try {
        const initialized = await initializationPromise;
        if (!initialized || !ortInitializationSuccessful || !pageInitializerReady) {
          throw new Error("Initialization failed (model/artifacts not ready or main world ORT setup failed).");
        }
        console.log("Initialization OK. Main world ORT setup OK.");

        const emailData = extractEmailDataFromDOM();
        if (!emailData) throw new Error("Could not extract email content from DOM.");
        console.log("Email data extracted successfully.");

        // --- MODIFICATION START ---
        // Consistent base text for all text processing, mirroring Python's likely use of text_combined (with HTML) for cleaning.
        const combinedRichText = `${emailData.subject || ''} ${emailData.bodyHtml || ''}`; // Use bodyHtml here

        // Clean this rich text once. This will be used for both handcrafted feature counts/keywords AND TF-IDF.
        const cleanedRichText = cleanTextForTfidf(combinedRichText); // Your JS equivalent of Python's clean_text
        console.log("Cleaned rich text (for TF-IDF & Handcrafted counts/keywords - sample):", cleanedRichText.substring(0, 100) + "...");

        // Call extractHandcraftedFeatures:
        // - emailData provides raw subject, bodyText, bodyHtml for features that need them directly (e.g., HTML parsing, specific raw text regexes).
        // - cleanedRichText provides the text base for word counts, sentence counts, keyword counts, etc., derived from subject + HTML body.
        const handcraftedFeaturesObject = extractHandcraftedFeatures(emailData, cleanedRichText);

        // Extract TF-IDF features using the same cleanedRichText for consistency.
        const tfidfSparse = extractTfidfFeatures(cleanedRichText);
        // --- MODIFICATION END ---

        const handcraftedNumericVector = vectorizeHandcraftedFeatures(handcraftedFeaturesObject);

        const combinedFullFeatureVector = combineFeatures(tfidfSparse, handcraftedNumericVector);

        const finalFeatureVector = selectKBestFeatures(combinedFullFeatureVector);

        const predictionResult = await getPredictionViaBridge(finalFeatureVector);
        console.log(`Scan complete. Prediction from Bridge: ${predictionResult}`);
        sendResponse({ result: predictionResult });

      } catch (error) {
        console.error('Error during email scan process in content.js:', error.stack || error);
        sendResponse({ error: error.message || 'Unknown error during scan.' });
      }
    };
    doScan();
    return true; // Indicates you will send a response asynchronously
  }
});