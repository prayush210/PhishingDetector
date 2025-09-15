# EMAIL PHISHING DETECTION GOOGLE CHROME EXTENSION WITH MACHINE LEARNING

## Abstract
This project is a Google Chrome extension that uses machine learning to classify and detect phishing emails in real-time, providing users with immediate warnings. It addresses the limitations of current server-based solutions, which introduce latency and privacy concerns, by operating directly within the user's browser. The extension combines advanced machine learning techniques with a user-centric design to create a robust and adaptable solution. The system performs real-time analysis, offers explainable warnings, and uses advanced feature engineering.

---

## Project Aims and Objectives
The primary aim is to design, develop, and evaluate a Google Chrome extension that uses client-side machine learning to accurately and instantly detect phishing emails within the user's environment, specifically targeting Gmail.

### Key Objectives
- **Developing an Optimised In-Browser ML Pipeline**  
  Creating a machine learning pipeline that combines feature extraction from the email's Document Object Model (DOM) and content. This pipeline is optimised for efficient and low-latency execution within the resource constraints of a web browser.

- **Achieving High-Accuracy Phishing Detection**  
  Training and selecting a lightweight machine learning model that achieves high accuracy on a benchmark phishing dataset. The model focuses on minimising the false positive rate to ensure user trust and usability.

- **Implementing Real-time DOM Analysis**  
  Developing and implementing robust JavaScript routines within the Chrome extension's content script to accurately parse the Gmail DOM and extract necessary features like sender details, subject, body text, and links.

- **Designing User-centric Alerting**  
  Creating an intuitive and non-intrusive user interface that clearly communicates potential phishing risks and provides understandable explanations for warnings.

- **Evaluating Feasibility and Performance**  
  Systematically evaluating the extension's performance characteristics, such as latency and its impact on browser responsiveness, and assessing the practical feasibility of the client-side ML approach.

---

## Technology Stack
- **Python**: Model development using Scikit-learn, Pandas, and NLTK.  
- **JavaScript**: Implementation of client-side logic, DOM manipulation, and user interface.  
- **ONNX (Open Neural Network Exchange)**: Deployment of Python-trained models in a JavaScript environment.

---

## Core Design Choice
The core design choice was to implement the machine learning inference entirely client-side, within the browser.  

### Reasons:
- **Privacy**: Email content is processed locally and not transmitted to external servers.  
- **Real-time Potential**: In-browser processing reduces latency compared to server-side solutions.  
- **Reduced Server Dependency**: No server infrastructure is required for hosting models or processing user data.  
- **Innovation**: Combines TF-IDF with 50+ handcrafted features, all running entirely client-side.

---

## Feature Engineering Strategy
A **hybrid feature approach** was adopted:

- **TF-IDF (Term Frequency–Inverse Document Frequency)**: Captures broad word usage patterns and keyword importance.  
- **Handcrafted Features**: Over 50 features targeting heuristics and phishing patterns (e.g., suspicious URLs, unusual HTML elements, sender anomalies).

---

## Model Choice
The **Linear Support Vector Classifier (LinearSVC)** was selected for:
- Strong performance (accuracy, F1-score)  
- Computational efficiency  
- Good generalisation  

---

## Project Outcomes
- A fully functional Chrome extension integrating ML for **real-time in-browser email scanning**.  
- Demonstrated **high accuracy** in end-to-end practical tests.  
- Achieved strong alignment between Python and JavaScript feature engineering, though some discrepancies remained.  
- Overall effectiveness of the extension was validated through real-world testing.  

---

## Future Work Suggestions
- **Enhanced Feature Parity**: Resolve discrepancies in the JavaScript feature engineering pipeline.  
- **More Robust DOM Interaction**: Improve resilience to Gmail UI changes.  
- **Model Updates & Automated Retraining**: Secure mechanism to keep ONNX models updated against evolving phishing tactics.  
- **Explainability Features**: Provide insights into why an email was flagged as phishing.  

---

## Author
**Prayush Rana**

## Supervisor
**Ehsan Toreini**

## University
**University of Surrey, Department of Computer Science**
