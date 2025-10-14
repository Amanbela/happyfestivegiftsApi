// --- OPTIMIZED Scraping API (Puppeteer Cluster + Caching) ---
const puppeteer = require("puppeteer");
const cheerio = require("cheerio");
const NodeCache = require("node-cache"); // Add: npm install node-cache

// Enhanced Configuration
const SCRAPING_CONFIG = {
  timeout: 25000, // Reduced from 30s
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36", // Updated Chrome
  viewport: { width: 1920, height: 1080 },
  maxConcurrency: 3, // Parallel scraping
  cacheTTL: 300, // 5 minutes cache
};

// Cache initialization
const searchCache = new NodeCache({
  stdTTL: SCRAPING_CONFIG.cacheTTL,
  checkperiod: 60,
});

// Browser pool for reuse
let browserPool = null;

const initBrowserPool = async () => {
  if (!browserPool) {
    browserPool = await puppeteer.launch({
      headless: "new",
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--disable-web-security",
        "--disable-features=VizDisplayCompositor",
        "--disable-software-rasterizer",
        "--disable-background-timer-throttling",
        "--disable-backgrounding-occluded-windows",
        "--disable-renderer-backgrounding",
        "--memory-pressure-off",
        "--max-old-space-size=8192",
      ],
      timeout: SCRAPING_CONFIG.timeout,
    });
  }
  return browserPool;
};

// Optimized safe scrape with connection pooling
const safeScrape = async (scrapeFunction, source, maxRetries = 2) => {
  let browser;
  let page;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      browser = await initBrowserPool();
      page = await browser.newPage();

      // Enhanced performance optimizations
      await Promise.all([
        page.setUserAgent(SCRAPING_CONFIG.userAgent),
        page.setViewport(SCRAPING_CONFIG.viewport),
        page.setDefaultNavigationTimeout(SCRAPING_CONFIG.timeout),
        page.setJavaScriptEnabled(true),
      ]);

      // Block unnecessary resources
      await page.setRequestInterception(true);
      page.on("request", (req) => {
        const resourceType = req.resourceType();
        if (["image", "stylesheet", "font", "media"].includes(resourceType)) {
          req.abort();
        } else {
          req.continue();
        }
      });

      const result = await scrapeFunction(page);
      return result;
    } catch (error) {
      console.error(`Attempt ${attempt} failed for ${source}:`, error.message);

      if (attempt === maxRetries) {
        throw new Error(
          `Failed to scrape ${source} after ${maxRetries} attempts: ${error.message}`
        );
      }

      // Exponential backoff with jitter
      const backoffTime = Math.min(
        1000 * Math.pow(2, attempt) + Math.random() * 1000,
        10000
      );
      await new Promise((resolve) => setTimeout(resolve, backoffTime));
    } finally {
      if (page && !page.isClosed()) {
        await page.close().catch(console.error);
      }
    }
  }
};

// Cache key generator
const generateCacheKey = (search, highprice, category, source) => {
  return `${source}:${search.toLowerCase().trim()}:${highprice}:${category}`;
};

// Enhanced validation
const validateScrapingParams = (search, highprice, category = "") => {
  if (!search || typeof search !== "string" || search.trim().length === 0) {
    throw new Error("Search query is required and must be a non-empty string");
  }

  if (search.length > 100) {
    throw new Error("Search query too long (max 100 characters)");
  }

  if (highprice && (isNaN(highprice) || highprice < 0 || highprice > 1000000)) {
    throw new Error("High price must be a positive number less than 1,000,000");
  }

  // Enhanced sanitization
  const sanitizedSearch = search
    .trim()
    .substring(0, 100)
    .replace(/[^\w\s-]/g, "");
  const sanitizedHighPrice = highprice
    ? Math.abs(parseFloat(highprice)).toFixed(2)
    : "";
  const sanitizedCategory = category ? category.trim().substring(0, 50) : "";

  return { sanitizedSearch, sanitizedHighPrice, sanitizedCategory };
};

// Optimized Myntra Scraper
const scrapeMyntra = async (search, highprice) => {
  const { sanitizedSearch, sanitizedHighPrice } = validateScrapingParams(
    search,
    highprice
  );
  const cacheKey = generateCacheKey(search, highprice, "", "myntra");

  // Check cache first
  const cached = searchCache.get(cacheKey);
  if (cached) {
    console.log("🚀 Serving Myntra results from cache");
    return cached;
  }

  const scrapeFunction = async (page) => {
    console.log(
      `🔍 Scraping Myntra for: ${sanitizedSearch} up to ${sanitizedHighPrice}`
    );

    const searchQuery = encodeURIComponent(
      sanitizedSearch.replace(/ /g, "-").toLowerCase()
    );
    const url = `https://www.myntra.com/${searchQuery}?rawQuery=${searchQuery}&price=0-${sanitizedHighPrice}`;

    try {
      await page.goto(url, {
        waitUntil: "networkidle2", // Better for dynamic content
        timeout: SCRAPING_CONFIG.timeout,
      });

      // Wait for products with shorter timeout
      await page
        .waitForSelector("li.product-base, [data-reactid]", { timeout: 10000 })
        .catch(() =>
          console.log(
            "Myntra products container not found immediately, continuing..."
          )
        );

      const html = await page.content();
      const $ = cheerio.load(html);
      const products = [];

      $("li.product-base")
        .slice(0, 50)
        .each((i, el) => {
          // Limit results
          try {
            const brand = $(el).find(".product-brand").text().trim();
            const productName = $(el).find(".product-product").text().trim();
            const title = `${brand} ${productName}`.trim();

            if (!title) return;

            let image =
              $(el).find("img.img-responsive").attr("src") ||
              $(el).find("source").attr("srcset")?.split("?")[0] ||
              $(el).find("img[src*='myntra']").attr("src");

            let priceText =
              $(el).find(".product-discountedPrice").text().trim() ||
              $(el).find("[data-product-price]").text().trim();
            let price = priceText.replace(/[^\d]/g, "");

            const originalPrice =
              $(el).find(".product-strike").text().replace(/[^\d]/g, "") ||
              price;
            const discount =
              $(el).find(".product-discountPercentage").text().trim() ||
              "0% off";
            const rating =
              $(el).find(".product-ratingsContainer").attr("title") ||
              "No rating";

            const href = $(el)
              .find("a[data-refreshpage='true'], a[href*='/buy/']")
              .attr("href");

            if (title && price && parseFloat(price) > 0) {
              products.push({
                image:
                  image ||
                  "https://images.unsplash.com/photo-1513475382585-d06e58bcb0e0?w=300&h=300&fit=crop",
                title: title.substring(0, 200), // Limit title length
                price: parseFloat(price) || 0,
                rating,
                offprice: parseFloat(originalPrice) || parseFloat(price),
                discount,
                href: href
                  ? `https://www.myntra.com/${href.replace(/^\/+/, "")}`
                  : "#",
                source: "myntra",
                score: calculateRelevanceScore(
                  title,
                  sanitizedSearch,
                  parseFloat(price)
                ),
              });
            }
          } catch (err) {
            console.error("Error processing Myntra product:", err);
          }
        });

      // Sort by relevance and price
      products.sort((a, b) => b.score - a.score || a.price - b.price);

      console.log(`✅ Myntra found ${products.length} products`);

      // Cache successful results
      if (products.length > 0) {
        searchCache.set(cacheKey, products);
      }

      return products;
    } catch (error) {
      console.error("Myntra scraping error:", error);
      throw error;
    }
  };

  return await safeScrape(scrapeFunction, "Myntra");
};

// Optimized Amazon Scraper
const scrapeAmazon = async (search, category, highprice) => {
  const { sanitizedSearch, sanitizedHighPrice, sanitizedCategory } =
    validateScrapingParams(search, highprice, category);
  const cacheKey = generateCacheKey(search, highprice, category, "amazon");

  // Check cache first
  const cached = searchCache.get(cacheKey);
  if (cached) {
    console.log("🚀 Serving Amazon results from cache");
    return cached;
  }

  const scrapeFunction = async (page) => {
    const searchQuery = encodeURIComponent(sanitizedSearch.replace(/ /g, "+"));
    const url = `https://www.amazon.in/s?k=${searchQuery}&i=${sanitizedCategory}&low-price=&high-price=${sanitizedHighPrice}`;

    try {
      await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: SCRAPING_CONFIG.timeout,
      });

      // Wait for results with fallback
      await Promise.race([
        page.waitForSelector("[data-component-type='s-search-result']", {
          timeout: 8000,
        }),
        page.waitForSelector(".s-result-item", { timeout: 8000 }),
      ]).catch(() =>
        console.log(
          "Amazon results container not found immediately, continuing..."
        )
      );

      const html = await page.content();
      const $ = cheerio.load(html);
      const results = [];

      // Multiple selector strategies for robustness
      $(
        "[data-component-type='s-search-result'], .s-result-item, .s-widget-container"
      )
        .slice(0, 60)
        .each((i, element) => {
          try {
            const $el = $(element);

            const image = $el
              .find(".s-image, .s-product-image-container img, img.s-image")
              .attr("src");
            const title = $el
              .find("h2 a span, .a-size-medium, .s-title-instructions-style")
              .first()
              .text()
              .trim();

            if (!title || title.length < 3) return;

            const priceText = $el
              .find(".a-price-whole, .a-price > .a-offscreen")
              .first()
              .text();
            const price = priceText.replace(/[^\d.]/g, "") || "0";

            if (parseFloat(price) === 0) return;

            const originalPrice =
              $el
                .find(".a-price[data-a-strike='true'] .a-offscreen")
                .text()
                .replace(/[^\d.]/g, "") || price;
            const rating =
              $el.find(".a-icon-alt").text().split(" ")[0] || "No rating";
            const href = $el.find("a.a-link-normal, h2 a").attr("href");

            if (title && parseFloat(price) > 0) {
              results.push({
                image: image || "",
                title: title.substring(0, 200),
                price: parseFloat(price),
                offprice: parseFloat(originalPrice),
                rating,
                href: href ? `https://www.amazon.in${href.split("?")[0]}` : "",
                source: "amazon",
                score: calculateRelevanceScore(
                  title,
                  sanitizedSearch,
                  parseFloat(price)
                ),
              });
            }
          } catch (err) {
            // Silent fail for individual product errors
          }
        });

      // Remove duplicates and sort
      const uniqueResults = Array.from(
        new Map(
          results.map((item) => [item.title.toLowerCase(), item])
        ).values()
      );
      uniqueResults.sort((a, b) => b.score - a.score || a.price - b.price);

      console.log(`✅ Amazon found ${uniqueResults.length} unique products`);

      // Cache successful results
      if (uniqueResults.length > 0) {
        searchCache.set(cacheKey, uniqueResults);
      }

      return uniqueResults;
    } catch (error) {
      console.error("Amazon scraping error:", error);
      throw error;
    }
  };

  return await safeScrape(scrapeFunction, "Amazon");
};

// Relevance scoring function
const calculateRelevanceScore = (title, search, price) => {
  const searchTerms = search.toLowerCase().split(" ");
  const titleLower = title.toLowerCase();

  let score = 0;

  // Title match scoring
  searchTerms.forEach((term) => {
    if (titleLower.includes(term)) {
      score += 10;
    }
  });

  // Exact match bonus
  if (titleLower.includes(search.toLowerCase())) {
    score += 20;
  }

  // Price scoring (prefer mid-range prices)
  const priceScore = Math.max(0, 50 - Math.abs(price - 1000) / 50);
  score += priceScore;

  return score;
};

// Graceful shutdown
process.on("SIGINT", async () => {
  console.log("Shutting down browser pool...");
  if (browserPool) {
    await browserPool.close();
  }
  process.exit(0);
});

// Optimized Controller
exports.scrape = async (req, res) => {
  const {
    search = "",
    category = "",
    highprice = "",
  } = req.body || req.query || {};
  const startTime = Date.now();

  try {
    if (!search || search.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: "Search query is required and cannot be empty",
      });
    }

    console.log(`🚀 Starting optimized scrape for: "${search}"`);

    // Parallel execution with timeout
    const scrapePromise = Promise.allSettled([
      scrapeAmazon(search, category, highprice),
      scrapeMyntra(search, highprice),
    ]);

    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Scraping timeout exceeded")), 20000)
    );

    const [amazonProducts, myntraProducts] = await Promise.race([
      scrapePromise,
      timeoutPromise,
    ]);

    let merged = [];
    const sources = { amazon: false, myntra: false };

    if (
      amazonProducts.status === "fulfilled" &&
      amazonProducts.value.length > 0
    ) {
      merged.push(...amazonProducts.value);
      sources.amazon = true;
      console.log(`✅ Amazon: ${amazonProducts.value.length} products`);
    } else {
      console.error("❌ Amazon scraping failed:", amazonProducts.reason);
    }

    if (
      myntraProducts.status === "fulfilled" &&
      myntraProducts.value.length > 0
    ) {
      merged.push(...myntraProducts.value);
      sources.myntra = true;
      console.log(`✅ Myntra: ${myntraProducts.value.length} products`);
    } else {
      console.error("❌ Myntra scraping failed:", myntraProducts.reason);
    }

    // Smart sorting: relevance score first, then price
    merged.sort((a, b) => (b.score || 0) - (a.score || 0) || a.price - b.price);

    const responseTime = Date.now() - startTime;

    res.json({
      success: true,
      products: merged.slice(0, 100), // Limit final results
      metadata: {
        total: merged.length,
        returned: Math.min(merged.length, 100),
        responseTime: `${responseTime}ms`,
        sources,
        cached: false, // Frontend can track cache hits differently
      },
    });

    console.log(
      `🎉 Scraping completed in ${responseTime}ms: ${merged.length} total products`
    );
  } catch (error) {
    const responseTime = Date.now() - startTime;
    console.error("💥 Scrape controller error:", error.message);

    res.status(500).json({
      success: false,
      error: error.message.includes("timeout")
        ? "Request timeout - try a simpler search"
        : "Error scraping products",
      products: [],
      metadata: {
        responseTime: `${responseTime}ms`,
        sources: { amazon: false, myntra: false },
      },
    });
  }
};

// Cache statistics endpoint (optional)
exports.cacheStats = (req, res) => {
  const stats = searchCache.getStats();
  res.json({
    success: true,
    cache: {
      hits: stats.hits,
      misses: stats.misses,
      keys: stats.keys,
      size: searchCache.keys().length,
    },
  });
};
