// --- Optimized Scraping Handlers (Puppeteer + Cheerio) ---
const puppeteer = require("puppeteer");
const cheerio = require("cheerio");

// --- Global Browser (Reuse for All Scrapes) ---
let browserInstance = null;

const getBrowser = async () => {
  if (!browserInstance) {
    browserInstance = await puppeteer.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
      ],
    });
  }
  return browserInstance;
};

process.on("exit", async () => {
  if (browserInstance) await browserInstance.close();
});

// --- Configuration ---
const SCRAPING_CONFIG = {
  timeout: 20000,
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
  viewport: { width: 1366, height: 768 },
};

// --- Helper: Delay ---
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// --- Safe Scrape Wrapper (with retries) ---
const safeScrape = async (scrapeFunction, source, maxRetries = 2) => {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await scrapeFunction(await getBrowser());
      return result;
    } catch (err) {
      console.error(`⚠️ ${source} attempt ${attempt} failed:`, err.message);
      if (attempt === maxRetries)
        throw new Error(`${source} failed after ${maxRetries} retries.`);
      await delay(1000 * attempt); // exponential backoff
    }
  }
};

// --- Validate and Sanitize Inputs ---
const validateScrapingParams = (search, highprice, category = "") => {
  if (!search || typeof search !== "string")
    throw new Error("Search query is required and must be a string");

  if (search.length > 100) throw new Error("Search query too long");

  if (highprice && (isNaN(highprice) || highprice < 0))
    throw new Error("High price must be a positive number");

  const sanitizedSearch = search.trim().substring(0, 100);
  const sanitizedHighPrice = highprice ? Math.abs(parseFloat(highprice)) : "";
  const sanitizedCategory = category ? category.trim() : "";

  return { sanitizedSearch, sanitizedHighPrice, sanitizedCategory };
};

// --- Page Setup Helper (reuse logic) ---
const setupPage = async (browser) => {
  const page = await browser.newPage();
  await page.setUserAgent(SCRAPING_CONFIG.userAgent);
  await page.setViewport(SCRAPING_CONFIG.viewport);

  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const blockTypes = ["image", "stylesheet", "font", "media"];
    if (blockTypes.includes(req.resourceType())) req.abort();
    else req.continue();
  });

  return page;
};

// --- Myntra Scraper ---
const scrapeMyntra = async (search, highprice) => {
  const { sanitizedSearch, sanitizedHighPrice } = validateScrapingParams(
    search,
    highprice
  );

  return await safeScrape(async (browser) => {
    console.log(`🔍 Myntra: Searching for "${sanitizedSearch}"`);

    const page = await setupPage(browser);
    const searchQuery = sanitizedSearch.replace(/ /g, "-").toLowerCase();
    const url = `https://www.myntra.com/${searchQuery}?rawQuery=${searchQuery}&price=0-${sanitizedHighPrice}`;
    const products = [];

    try {
      await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: SCRAPING_CONFIG.timeout,
      });

      await Promise.race([
        page.waitForSelector("li.product-base", { timeout: 10000 }),
        delay(12000),
      ]);

      const html = await page.content();
      const $ = cheerio.load(html);

      $("li.product-base").each((_, el) => {
        try {
          const brand = $(el).find(".product-brand").text().trim();
          const productName = $(el).find(".product-product").text().trim();
          const title = `${brand} ${productName}`.trim();
          let price = $(el).find(".product-discountedPrice").text().trim();
          price = price.replace(/[^\d]/g, "");
          if (!price) return;

          const image =
            $(el).find("img.img-responsive").attr("src") ||
            $(el).find("source").attr("srcset")?.split("?")[0] ||
            "https://images.unsplash.com/photo-1513475382585-d06e58bcb0e0?w=300";
          const originalPrice = $(el)
            .find(".product-strike")
            .text()
            .replace(/[^\d]/g, "");
          const discount = $(el)
            .find(".product-discountPercentage")
            .text()
            .trim();
          const rating =
            $(el).find(".product-ratingsContainer").attr("title") ||
            "No rating";
          const href = $(el).find("a[data-refreshpage='true']").attr("href");

          products.push({
            image,
            title,
            price,
            offprice: originalPrice || price,
            discount: discount || "0% off",
            rating,
            href: href
              ? `https://linkredirect.in/visitretailer/2468?id=4620459&shareid=rol1uA1&dl=https://www.myntra.com/${href}`
              : "https://myntr.it/wA7A1Hl",
            source: "myntra",
          });
        } catch (err) {
          console.error("Myntra parse error:", err.message);
        }
      });

      console.log(`✅ Myntra: ${products.length} products found`);
      return products;
    } finally {
      await page.close().catch(() => {});
    }
  }, "Myntra");
};

// --- Amazon Scraper ---
const scrapeAmazon = async (search, category, highprice) => {
  const { sanitizedSearch, sanitizedHighPrice, sanitizedCategory } =
    validateScrapingParams(search, highprice, category);

  return await safeScrape(async (browser) => {
    console.log(`🔍 Amazon: Searching for "${sanitizedSearch}"`);

    const page = await setupPage(browser);
    const searchQuery = sanitizedSearch.replace(/ /g, "+");
    const url = `https://www.amazon.in/s?k=${searchQuery}&i=${sanitizedCategory}&high-price=${sanitizedHighPrice}`;
    const results = [];

    try {
      await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: SCRAPING_CONFIG.timeout,
      });

      await Promise.race([
        page.waitForSelector("[data-component-type='s-search-result']", {
          timeout: 10000,
        }),
        delay(12000),
      ]);

      const html = await page.content();
      const $ = cheerio.load(html);

      $("[data-component-type='s-search-result']").each((_, el) => {
        try {
          const title = $(el).find("h2 span").text().trim();
          const price = $(el)
            .find(".a-price .a-offscreen")
            .first()
            .text()
            .replace(/[^\d]/g, "");
          if (!title || !price) return;

          const image =
            $(el).find(".s-image").attr("src") ||
            "https://via.placeholder.com/200";
          let href = $(el).find("a.a-link-normal").attr("href") || "#";
          if (href !== "#") {
            const cleanHref = href.split("?")[0];
            const separator = href.includes("?") ? "&" : "?";
            href = `https://www.amazon.in${cleanHref}${separator}tag=happyfestiveg-21`;
          } else {
            href = "https://www.amazon.in";
          }
          const offprice = $(el)
            .find(".a-text-price .a-offscreen")
            .text()
            .replace(/[^\d]/g, "");
          const limit_time = $(el).find(".s-deal-badge").text().trim();

          results.push({
            image,
            title,
            price,
            offprice: offprice || price,
            limit_time,
            href,
            source: "amazon",
          });
        } catch (err) {
          console.error("Amazon parse error:", err.message);
        }
      });

      const unique = Array.from(
        new Map(results.map((p) => [p.title, p])).values()
      );

      console.log(`✅ Amazon: ${unique.length} products found`);
      return unique;
    } finally {
      await page.close().catch(() => {});
    }
  }, "Amazon");
};

// --- Controller ---
exports.scrape = async (req, res) => {
  const {
    search = "",
    category = "",
    highprice = "",
  } = req.body || req.query || {};

  if (!search)
    return res.status(400).json({ error: "Search query is required" });

  console.log(`🚀 Starting scrape for "${search}"`);

  try {
    const [amazon, myntra] = await Promise.allSettled([
      scrapeAmazon(search, category, highprice),
      scrapeMyntra(search, highprice),
    ]);

    let products = [];
    if (amazon.status === "fulfilled") {
      products = [...products, ...amazon.value];
      console.log(`Amazon OK: ${amazon.value.length}`);
    } else console.error("Amazon failed:", amazon.reason?.message);

    if (myntra.status === "fulfilled") {
      products = [...products, ...myntra.value];
      console.log(`Myntra OK: ${myntra.value.length}`);
    } else console.error("Myntra failed:", myntra.reason?.message);

    products.sort(
      (a, b) => parseFloat(a.price || 0) - parseFloat(b.price || 0)
    );

    res.json({
      success: true,
      total: products.length,
      products,
      sources: {
        amazon: amazon.status === "fulfilled",
        myntra: myntra.status === "fulfilled",
      },
    });
  } catch (err) {
    console.error("❌ Controller error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
};
