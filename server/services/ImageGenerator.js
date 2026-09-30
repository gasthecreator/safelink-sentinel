// server/services/ImageGenerator.js

// AI Image Generation Service
// Generates relevant medical/first aid images using AI or returns medical icon illustrations

const https = require("https");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

// Cache directory for generated images
const CACHE_DIR = path.join(process.cwd(), "data", "first-aid-images");
if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

// Medical icon illustrations (SVG data URLs) - fallback when AI generation fails
const medicalIcons = {
  cpr: {
    "Check for Responsiveness": "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAwIiBoZWlnaHQ9IjMwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iNDAwIiBoZWlnaHQ9IjMwMCIgZmlsbD0iI2Y4ZmFmYyIvPjx0ZXh0IHg9IjUwJSIgeT0iNDAlIiBmb250LXNpemU9IjQ4IiBmb250LWZhbWlseT0iQXJpYWwiIGZvbnQtd2VpZ2h0PSJib2xkIiBmaWxsPSIjZWY0NDQ0IiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBkeT0iLjNlbSI+8J+OhyBDaGVjayBSZXNwb25zaXZlbmVzczwvdGV4dD48L3N2Zz4=",
    "Open the Airway": "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAwIiBoZWlnaHQ9IjMwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iNDAwIiBoZWlnaHQ9IjMwMCIgZmlsbD0iI2Y4ZmFmYyIvPjx0ZXh0IHg9IjUwJSIgeT0iNDAlIiBmb250LXNpemU9IjQ4IiBmb250LWZhbWlseT0iQXJpYWwiIGZvbnQtd2VpZ2h0PSJib2xkIiBmaWxsPSIjZWY0NDQ0IiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBkeT0iLjNlbSI+8J+OhyBPcGVuIEFpcndheTwvdGV4dD48L3N2Zz4=",
    "Begin Chest Compressions": "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAwIiBoZWlnaHQ9IjMwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iNDAwIiBoZWlnaHQ9IjMwMCIgZmlsbD0iI2Y4ZmFmYyIvPjx0ZXh0IHg9IjUwJSIgeT0iNDAlIiBmb250LXNpemU9IjQ4IiBmb250LWZhbWlseT0iQXJpYWwiIGZvbnQtd2VpZ2h0PSJib2xkIiBmaWxsPSIjZWY0NDQ0IiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBkeT0iLjNlbSI+8J+OhyBDaGVzdCBDb21wcmVzc2lvbnM8L3RleHQ+PC9zdmc+",
    "Give Rescue Breaths": "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAwIiBoZWlnaHQ9IjMwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iNDAwIiBoZWlnaHQ9IjMwMCIgZmlsbD0iI2Y4ZmFmYyIvPjx0ZXh0IHg9IjUwJSIgeT0iNDAlIiBmb250LXNpemU9IjQ4IiBmb250LWZhbWlseT0iQXJpYWwiIGZvbnQtd2VpZ2h0PSJib2xkIiBmaWxsPSIjZWY0NDQ0IiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBkeT0iLjNlbSI+8J+OhyBSZXNjdWUgQnJlYXRoczwvdGV4dD48L3N2Zz4=",
  },
  bleeding: {
    "Apply Direct Pressure": "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAwIiBoZWlnaHQ9IjMwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iNDAwIiBoZWlnaHQ9IjMwMCIgZmlsbD0iI2Y4ZmFmYyIvPjx0ZXh0IHg9IjUwJSIgeT0iNDAlIiBmb250LXNpemU9IjQ4IiBmb250LWZhbWlseT0iQXJpYWwiIGZvbnQtd2VpZ2h0PSJib2xkIiBmaWxsPSIjZGMyNjI2IiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBkeT0iLjNlbSI+8J+OhyBBcHBseSBQcmVzc3VyZTwvdGV4dD48L3N2Zz4=",
    "Apply Bandage": "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAwIiBoZWlnaHQ9IjMwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iNDAwIiBoZWlnaHQ9IjMwMCIgZmlsbD0iI2Y4ZmFmYyIvPjx0ZXh0IHg9IjUwJSIgeT0iNDAlIiBmb250LXNpemU9IjQ4IiBmb250LWZhbWlseT0iQXJpYWwiIGZvbnQtd2VpZ2h0PSJib2xkIiBmaWxsPSIjZGMyNjI2IiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBkeT0iLjNlbSI+8J+OhyBCYW5kYWdlPC90ZXh0Pjwvc3ZnPg==",
  },
  choking: {
    "Perform Abdominal Thrusts (Heimlich)": "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAwIiBoZWlnaHQ9IjMwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iNDAwIiBoZWlnaHQ9IjMwMCIgZmlsbD0iI2Y4ZmFmYyIvPjx0ZXh0IHg9IjUwJSIgeT0iNDAlIiBmb250LXNpemU9IjQ4IiBmb250LWZhbWlseT0iQXJpYWwiIGZvbnQtd2VpZ2h0PSJib2xkIiBmaWxsPSIjZWY0NDQ0IiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBkeT0iLjNlbSI+8J+OhyBIZWltbGljaDwvdGV4dD48L3N2Zz4=",
  },
  burns: {
    "Cool the Burn": "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAwIiBoZWlnaHQ9IjMwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iNDAwIiBoZWlnaHQ9IjMwMCIgZmlsbD0iI2Y4ZmFmYyIvPjx0ZXh0IHg9IjUwJSIgeT0iNDAlIiBmb250LXNpemU9IjQ4IiBmb250LWZhbWlseT0iQXJpYWwiIGZvbnQtd2VpZ2h0PSJib2xkIiBmaWxsPSIjZjU5NzBiIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBkeT0iLjNlbSI+8J+OhyBDb29sIEJ1cm48L3RleHQ+PC9zdmc+",
    "Cover the Burn": "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAwIiBoZWlnaHQ9IjMwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iNDAwIiBoZWlnaHQ9IjMwMCIgZmlsbD0iI2Y4ZmFmYyIvPjx0ZXh0IHg9IjUwJSIgeT0iNDAlIiBmb250LXNpemU9IjQ4IiBmb250LWZhbWlseT0iQXJpYWwiIGZvbnQtd2VpZ2h0PSJib2xkIiBmaWxsPSIjZjU5NzBiIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBkeT0iLjNlbSI+8J+OhyBDb3ZlciBCdXJuPC90ZXh0Pjwvc3ZnPg==",
  },
  default: "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAwIiBoZWlnaHQ9IjMwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iNDAwIiBoZWlnaHQ9IjMwMCIgZmlsbD0iI2Y4ZmFmYyIvPjx0ZXh0IHg9IjUwJSIgeT0iNDAlIiBmb250LXNpemU9IjQ4IiBmb250LWZhbWlseT0iQXJpYWwiIGZvbnQtd2VpZ2h0PSJib2xkIiBmaWxsPSIjM2I4MmY2IiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBkeT0iLjNlbSI+8J+OhyBGaXJzdCBBaWQ8L3RleHQ+PC9zdmc+",
};

// Generate a prompt for AI image generation based on step description
function generateImagePrompt(situation, stepTitle, stepDescription) {
  const prompts = {
    cpr: {
      "Check for Responsiveness": "medical illustration, person checking responsiveness, tapping shoulder, first aid, clean professional medical drawing",
      "Open the Airway": "medical illustration, opening airway, head tilt chin lift technique, first aid CPR, clean professional medical drawing",
      "Check for Breathing": "medical illustration, checking for breathing, look listen feel, first aid CPR, clean professional medical drawing",
      "Begin Chest Compressions": "medical illustration, chest compressions CPR, hands on chest, first aid, clean professional medical drawing",
      "Give Rescue Breaths": "medical illustration, rescue breaths CPR, mouth to mouth, first aid, clean professional medical drawing",
    },
    bleeding: {
      "Apply Direct Pressure": "medical illustration, applying pressure to wound, first aid bleeding control, clean professional medical drawing",
      "Elevate the Injury": "medical illustration, elevating injured limb, first aid bleeding control, clean professional medical drawing",
      "Apply Bandage": "medical illustration, applying bandage to wound, first aid bleeding control, clean professional medical drawing",
      "Don't Remove Objects": "medical illustration, object embedded in wound, do not remove, first aid, clean professional medical drawing",
    },
    choking: {
      "Recognize Choking": "medical illustration, person choking, clutching throat, first aid, clean professional medical drawing",
      "Perform Back Blows": "medical illustration, back blows for choking, first aid Heimlich maneuver, clean professional medical drawing",
      "Perform Abdominal Thrusts (Heimlich)": "medical illustration, Heimlich maneuver, abdominal thrusts, first aid choking, clean professional medical drawing",
      "Continue Until Object is Expelled": "medical illustration, Heimlich maneuver continuation, first aid choking, clean professional medical drawing",
    },
    burns: {
      "Cool the Burn": "medical illustration, cooling burn with water, first aid burn treatment, clean professional medical drawing",
      "Remove Constrictive Items": "medical illustration, removing jewelry from burn area, first aid, clean professional medical drawing",
      "Cover the Burn": "medical illustration, covering burn with bandage, first aid burn treatment, clean professional medical drawing",
      "Manage Pain": "medical illustration, burn pain management, first aid, clean professional medical drawing",
    },
    seizures: {
      "Keep the Person Safe": "medical illustration, person having seizure, keeping safe, first aid, clean professional medical drawing",
      "Protect the Head": "medical illustration, protecting head during seizure, first aid, clean professional medical drawing",
      "Don't Restrain": "medical illustration, do not restrain during seizure, first aid, clean professional medical drawing",
      "Time the Seizure": "medical illustration, timing seizure, first aid, clean professional medical drawing",
    },
    fractures: {
      "Don't Move the Person": "medical illustration, do not move person with fracture, first aid, clean professional medical drawing",
      "Stop Any Bleeding": "medical illustration, stopping bleeding from fracture, first aid, clean professional medical drawing",
      "Immobilize the Area": "medical illustration, splinting fracture, immobilizing injury, first aid, clean professional medical drawing",
      "Apply Ice": "medical illustration, applying ice to fracture, first aid, clean professional medical drawing",
    },
    shock: {
      "Call Emergency Services": "medical illustration, calling emergency services, first aid shock, clean professional medical drawing",
      "Lay the Person Down": "medical illustration, laying person down for shock, elevating legs, first aid, clean professional medical drawing",
      "Keep Them Warm": "medical illustration, keeping person warm during shock, blanket, first aid, clean professional medical drawing",
      "Monitor Breathing": "medical illustration, monitoring breathing during shock, first aid, clean professional medical drawing",
    },
  };

  if (prompts[situation] && prompts[situation][stepTitle]) {
    return prompts[situation][stepTitle];
  }

  // Fallback: generate prompt from step description
  return `medical illustration, ${stepTitle.toLowerCase()}, ${stepDescription.substring(0, 50)}, first aid, clean professional medical drawing, step by step instruction`;
}

// Generate image using Hugging Face Stable Diffusion API (free tier)
async function generateAIImage(prompt, situation, stepTitle) {
  return new Promise((resolve, reject) => {
    // For now, we'll use a placeholder service that generates medical illustrations
    // In production, you can integrate with Hugging Face API, DALL-E, or Stable Diffusion
    
    // Check cache first
    const cacheKey = crypto.createHash("md5").update(`${situation}-${stepTitle}`).digest("hex");
    const cachePath = path.join(CACHE_DIR, `${cacheKey}.json`);
    
    if (fs.existsSync(cachePath)) {
      try {
        const cached = JSON.parse(fs.readFileSync(cachePath, "utf8"));
        console.log(`[ImageGenerator] ✅ Using cached image for: ${stepTitle}`);
        return resolve(cached.imageUrl);
      } catch (err) {
        console.error(`[ImageGenerator] ❌ Error reading cache:`, err);
      }
    }

    // For hackathon: Use medical illustration service or return icon
    // Using a free medical illustration API or generating SVG
    
    // Generate a medical illustration SVG
    const svg = generateMedicalIllustrationSVG(situation, stepTitle, prompt);
    const dataUrl = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
    
    // Cache it
    try {
      fs.writeFileSync(cachePath, JSON.stringify({ imageUrl: dataUrl, prompt, timestamp: Date.now() }));
    } catch (err) {
      console.error(`[ImageGenerator] ❌ Error caching image:`, err);
    }
    
    console.log(`[ImageGenerator] ✅ Generated medical illustration for: ${stepTitle}`);
    resolve(dataUrl);
  });
}

// Generate medical illustration SVG with human figures performing actions
function generateMedicalIllustrationSVG(situation, stepTitle, prompt) {
  // Get illustration data based on step
  const illustration = getStepIllustration(situation, stepTitle);
  
  return `<svg width="400" height="300" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300">
    <defs>
      <linearGradient id="bgGrad${situation}" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" style="stop-color:#f8fafc;stop-opacity:1" />
        <stop offset="100%" style="stop-color:#ffffff;stop-opacity:1" />
      </linearGradient>
    </defs>
    <rect width="400" height="300" fill="url(#bgGrad${situation})"/>
    ${illustration.svg}
  </svg>`;
}

// Get step-specific illustrations with human figures
function getStepIllustration(situation, stepTitle) {
  const illustrations = {
    cpr: {
      "Check for Responsiveness": {
        svg: `
          <!-- Person lying down -->
          <ellipse cx="200" cy="200" rx="80" ry="30" fill="#e2e8f0"/>
          <circle cx="200" cy="150" r="25" fill="#fbbf24"/>
          <!-- Hands tapping shoulder -->
          <path d="M 140 140 Q 130 130 125 120" stroke="#3b82f6" stroke-width="3" fill="none" marker-end="url(#arrowhead)"/>
          <circle cx="125" cy="120" r="8" fill="#3b82f6"/>
          <text x="200" y="250" font-family="Arial, sans-serif" font-size="12" fill="#64748b" text-anchor="middle">Checking responsiveness</text>
        `,
      },
      "Open the Airway": {
        svg: `
          <!-- Person's head -->
          <ellipse cx="200" cy="180" rx="80" ry="30" fill="#e2e8f0"/>
          <circle cx="200" cy="130" r="25" fill="#fbbf24"/>
          <!-- Hand on forehead -->
          <path d="M 150 120 L 140 110" stroke="#3b82f6" stroke-width="4" fill="none"/>
          <circle cx="140" cy="110" r="10" fill="#3b82f6"/>
          <!-- Fingers under chin -->
          <path d="M 170 150 L 180 160" stroke="#3b82f6" stroke-width="3" fill="none"/>
          <circle cx="180" cy="160" r="6" fill="#3b82f6"/>
          <text x="200" y="250" font-family="Arial, sans-serif" font-size="12" fill="#64748b" text-anchor="middle">Head tilt, chin lift</text>
        `,
      },
      "Check for Breathing": {
        svg: `
          <!-- Person -->
          <ellipse cx="200" cy="200" rx="80" ry="30" fill="#e2e8f0"/>
          <circle cx="200" cy="150" r="25" fill="#fbbf24"/>
          <!-- Ear to mouth (checking breathing) -->
          <circle cx="180" cy="140" r="12" fill="#3b82f6"/>
          <path d="M 170 140 Q 160 135 155 130" stroke="#3b82f6" stroke-width="2" fill="none"/>
          <path d="M 200 145 Q 210 140 215 135" stroke="#10b981" stroke-width="2" fill="none"/>
          <text x="200" y="250" font-family="Arial, sans-serif" font-size="12" fill="#64748b" text-anchor="middle">Look, listen, feel</text>
        `,
      },
      "Begin Chest Compressions": {
        svg: `
          <!-- Person lying down -->
          <ellipse cx="200" cy="200" rx="80" ry="30" fill="#e2e8f0"/>
          <circle cx="200" cy="150" r="25" fill="#fbbf24"/>
          <!-- Hands on chest -->
          <rect x="185" y="165" width="30" height="20" rx="5" fill="#ef4444" opacity="0.8"/>
          <circle cx="190" cy="175" r="6" fill="#3b82f6"/>
          <circle cx="210" cy="175" r="6" fill="#3b82f6"/>
          <!-- Compression arrows -->
          <path d="M 200 145 L 200 165" stroke="#ef4444" stroke-width="3" fill="none" marker-end="url(#arrowhead)"/>
          <text x="200" y="250" font-family="Arial, sans-serif" font-size="12" fill="#64748b" text-anchor="middle">Chest compressions</text>
        `,
      },
      "Give Rescue Breaths": {
        svg: `
          <!-- Person lying down -->
          <ellipse cx="200" cy="200" rx="80" ry="30" fill="#e2e8f0"/>
          <circle cx="200" cy="150" r="25" fill="#fbbf24"/>
          <!-- Person giving breaths -->
          <circle cx="200" cy="100" r="18" fill="#fbbf24"/>
          <!-- Air flow -->
          <path d="M 200 118 Q 200 130 200 145" stroke="#10b981" stroke-width="4" fill="none" stroke-dasharray="5,5"/>
          <text x="200" y="250" font-family="Arial, sans-serif" font-size="12" fill="#64748b" text-anchor="middle">Rescue breaths</text>
        `,
      },
    },
    bleeding: {
      "Apply Direct Pressure": {
        svg: `
          <!-- Arm with wound -->
          <rect x="150" y="120" width="100" height="40" rx="20" fill="#fbbf24"/>
          <circle cx="200" cy="140" r="12" fill="#dc2626"/>
          <!-- Hand applying pressure -->
          <circle cx="200" cy="110" r="15" fill="#3b82f6"/>
          <path d="M 200 95 L 200 125" stroke="#3b82f6" stroke-width="6" fill="none"/>
          <!-- Gauze/cloth -->
          <rect x="188" y="125" width="24" height="20" rx="3" fill="#ffffff" opacity="0.9"/>
          <text x="200" y="250" font-family="Arial, sans-serif" font-size="12" fill="#64748b" text-anchor="middle">Apply pressure to wound</text>
        `,
      },
      "Elevate the Injury": {
        svg: `
          <!-- Arm elevated -->
          <path d="M 150 200 L 200 120 L 250 200" stroke="#fbbf24" stroke-width="30" fill="none" stroke-linecap="round"/>
          <!-- Wound -->
          <circle cx="200" cy="140" r="10" fill="#dc2626"/>
          <!-- Bandage -->
          <rect x="190" y="130" width="20" height="15" rx="2" fill="#ffffff"/>
          <text x="200" y="250" font-family="Arial, sans-serif" font-size="12" fill="#64748b" text-anchor="middle">Elevate above heart</text>
        `,
      },
      "Apply Bandage": {
        svg: `
          <!-- Arm -->
          <rect x="150" y="130" width="100" height="35" rx="18" fill="#fbbf24"/>
          <!-- Bandage wrapping -->
          <rect x="180" y="125" width="40" height="45" rx="5" fill="#ffffff" opacity="0.9"/>
          <path d="M 180 125 Q 200 135 220 125" stroke="#3b82f6" stroke-width="2" fill="none"/>
          <path d="M 180 145 Q 200 155 220 145" stroke="#3b82f6" stroke-width="2" fill="none"/>
          <path d="M 180 165 Q 200 175 220 165" stroke="#3b82f6" stroke-width="2" fill="none"/>
          <text x="200" y="250" font-family="Arial, sans-serif" font-size="12" fill="#64748b" text-anchor="middle">Bandage applied</text>
        `,
      },
    },
    choking: {
      "Perform Abdominal Thrusts (Heimlich)": {
        svg: `
          <!-- Person being helped -->
          <ellipse cx="200" cy="200" rx="60" ry="25" fill="#e2e8f0"/>
          <circle cx="200" cy="150" r="22" fill="#fbbf24"/>
          <!-- Helper behind -->
          <circle cx="200" cy="100" r="20" fill="#fbbf24"/>
          <!-- Arms around waist (Heimlich) -->
          <path d="M 160 140 Q 140 160 130 180" stroke="#3b82f6" stroke-width="8" fill="none" stroke-linecap="round"/>
          <path d="M 240 140 Q 260 160 270 180" stroke="#3b82f6" stroke-width="8" fill="none" stroke-linecap="round"/>
          <!-- Hands clasped -->
          <circle cx="200" cy="165" r="10" fill="#ef4444"/>
          <!-- Thrust arrows -->
          <path d="M 200 155 L 200 175" stroke="#ef4444" stroke-width="4" fill="none" marker-end="url(#arrowhead)"/>
          <text x="200" y="250" font-family="Arial, sans-serif" font-size="12" fill="#64748b" text-anchor="middle">Heimlich maneuver</text>
        `,
      },
    },
    burns: {
      "Cool the Burn": {
        svg: `
          <!-- Hand with burn -->
          <path d="M 180 140 L 220 140 L 215 180 L 185 180 Z" fill="#fbbf24"/>
          <!-- Burn area -->
          <circle cx="200" cy="160" r="15" fill="#dc2626" opacity="0.6"/>
          <!-- Water droplets -->
          <circle cx="190" cy="120" r="4" fill="#3b82f6"/>
          <circle cx="200" cy="115" r="5" fill="#3b82f6"/>
          <circle cx="210" cy="120" r="4" fill="#3b82f6"/>
          <!-- Water flow -->
          <path d="M 200 110 L 200 145" stroke="#3b82f6" stroke-width="3" fill="none" stroke-dasharray="3,3"/>
          <text x="200" y="250" font-family="Arial, sans-serif" font-size="12" fill="#64748b" text-anchor="middle">Cool with running water</text>
        `,
      },
      "Cover the Burn": {
        svg: `
          <!-- Hand -->
          <path d="M 180 140 L 220 140 L 215 180 L 185 180 Z" fill="#fbbf24"/>
          <!-- Burn -->
          <circle cx="200" cy="160" r="12" fill="#dc2626" opacity="0.5"/>
          <!-- Bandage covering -->
          <rect x="185" y="145" width="30" height="25" rx="3" fill="#ffffff" opacity="0.9"/>
          <path d="M 185 150 Q 200 155 215 150" stroke="#94a3b8" stroke-width="1" fill="none"/>
          <text x="200" y="250" font-family="Arial, sans-serif" font-size="12" fill="#64748b" text-anchor="middle">Cover with bandage</text>
        `,
      },
    },
    seizures: {
      "Keep the Person Safe": {
        svg: `
          <!-- Person on ground -->
          <ellipse cx="200" cy="220" rx="70" ry="25" fill="#e2e8f0"/>
          <circle cx="200" cy="160" r="20" fill="#fbbf24"/>
          <!-- Protective hands -->
          <circle cx="150" cy="180" r="12" fill="#3b82f6"/>
          <circle cx="250" cy="180" r="12" fill="#3b82f6"/>
          <!-- Safe zone indicator -->
          <circle cx="200" cy="190" r="60" stroke="#10b981" stroke-width="2" fill="none" stroke-dasharray="5,5"/>
          <text x="200" y="250" font-family="Arial, sans-serif" font-size="12" fill="#64748b" text-anchor="middle">Clear safe area</text>
        `,
      },
      "Protect the Head": {
        svg: `
          <!-- Person -->
          <ellipse cx="200" cy="220" rx="70" ry="25" fill="#e2e8f0"/>
          <circle cx="200" cy="160" r="20" fill="#fbbf24"/>
          <!-- Pillow under head -->
          <ellipse cx="200" cy="175" rx="30" ry="10" fill="#fef3c7"/>
          <!-- Protective hand -->
          <circle cx="200" cy="150" r="12" fill="#3b82f6"/>
          <text x="200" y="250" font-family="Arial, sans-serif" font-size="12" fill="#64748b" text-anchor="middle">Support head</text>
        `,
      },
    },
    fractures: {
      "Immobilize the Area": {
        svg: `
          <!-- Leg with fracture -->
          <path d="M 180 100 L 200 200" stroke="#fbbf24" stroke-width="25" fill="none" stroke-linecap="round"/>
          <!-- Splint (boards) -->
          <rect x="175" y="120" width="10" height="80" rx="2" fill="#78716c"/>
          <rect x="215" y="120" width="10" height="80" rx="2" fill="#78716c"/>
          <!-- Bandage wrapping -->
          <path d="M 175 140 Q 200 150 225 140" stroke="#ffffff" stroke-width="4" fill="none"/>
          <path d="M 175 170 Q 200 180 225 170" stroke="#ffffff" stroke-width="4" fill="none"/>
          <text x="200" y="250" font-family="Arial, sans-serif" font-size="12" fill="#64748b" text-anchor="middle">Splint applied</text>
        `,
      },
      "Apply Ice": {
        svg: `
          <!-- Leg -->
          <path d="M 180 120 L 200 200" stroke="#fbbf24" stroke-width="25" fill="none" stroke-linecap="round"/>
          <!-- Ice pack -->
          <rect x="185" y="140" width="30" height="25" rx="5" fill="#dbeafe" opacity="0.8"/>
          <circle cx="195" cy="152" r="3" fill="#3b82f6"/>
          <circle cx="205" cy="152" r="3" fill="#3b82f6"/>
          <circle cx="200" cy="158" r="3" fill="#3b82f6"/>
          <!-- Cloth wrapping -->
          <path d="M 185 145 Q 200 150 215 145" stroke="#ffffff" stroke-width="3" fill="none"/>
          <text x="200" y="250" font-family="Arial, sans-serif" font-size="12" fill="#64748b" text-anchor="middle">Ice pack applied</text>
        `,
      },
    },
    shock: {
      "Lay the Person Down": {
        svg: `
          <!-- Person lying down -->
          <ellipse cx="200" cy="220" rx="80" ry="30" fill="#e2e8f0"/>
          <circle cx="200" cy="160" r="22" fill="#fbbf24"/>
          <!-- Legs elevated -->
          <path d="M 160 220 L 180 180" stroke="#fbbf24" stroke-width="20" fill="none" stroke-linecap="round"/>
          <path d="M 240 220 L 220 180" stroke="#fbbf24" stroke-width="20" fill="none" stroke-linecap="round"/>
          <!-- Support under legs -->
          <rect x="170" y="190" width="60" height="8" rx="4" fill="#94a3b8"/>
          <text x="200" y="250" font-family="Arial, sans-serif" font-size="12" fill="#64748b" text-anchor="middle">Legs elevated</text>
        `,
      },
      "Keep Them Warm": {
        svg: `
          <!-- Person -->
          <ellipse cx="200" cy="220" rx="80" ry="30" fill="#e2e8f0"/>
          <circle cx="200" cy="160" r="22" fill="#fbbf24"/>
          <!-- Blanket -->
          <path d="M 120 190 Q 200 170 280 190" stroke="#fbbf24" stroke-width="50" fill="none" stroke-linecap="round" opacity="0.7"/>
          <text x="200" y="250" font-family="Arial, sans-serif" font-size="12" fill="#64748b" text-anchor="middle">Keep warm</text>
        `,
      },
    },
  };

  // Add arrowhead marker definition
  const arrowheadDef = `
    <defs>
      <marker id="arrowhead" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto">
        <polygon points="0 0, 10 3, 0 6" fill="#3b82f6" />
      </marker>
    </defs>
  `;

  if (illustrations[situation] && illustrations[situation][stepTitle]) {
    return {
      svg: arrowheadDef + illustrations[situation][stepTitle].svg,
    };
  }

  // Default illustration
  return {
    svg: `
      ${arrowheadDef}
      <circle cx="200" cy="150" r="40" fill="#f1f5f9" stroke="#3b82f6" stroke-width="3"/>
      <text x="200" y="155" font-family="Arial, sans-serif" font-size="16" fill="#3b82f6" text-anchor="middle">First Aid</text>
      <text x="200" y="250" font-family="Arial, sans-serif" font-size="12" fill="#64748b" text-anchor="middle">${escapeXml(stepTitle.substring(0, 30))}</text>
    `,
  };
}

function escapeXml(unsafe) {
  return unsafe.replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case "<": return "&lt;";
      case ">": return "&gt;";
      case "&": return "&amp;";
      case "'": return "&apos;";
      case '"': return "&quot;";
      default: return c;
    }
  });
}

// Main function to get image for a step
async function getImageForStep(situation, stepTitle, stepDescription) {
  try {
    // Check if we have a cached medical icon
    if (medicalIcons[situation] && medicalIcons[situation][stepTitle]) {
      return medicalIcons[situation][stepTitle];
    }

    // Generate AI image
    const prompt = generateImagePrompt(situation, stepTitle, stepDescription);
    const imageUrl = await generateAIImage(prompt, situation, stepTitle);
    return imageUrl;
  } catch (error) {
    console.error(`[ImageGenerator] ❌ Error generating image:`, error);
    // Fallback to default icon
    return medicalIcons.default;
  }
}

module.exports = {
  getImageForStep,
  generateImagePrompt,
  generateMedicalIllustrationSVG,
};

