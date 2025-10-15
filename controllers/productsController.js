// --- Scraping related handlers (uses puppeteer + cheerio) ---
const puppeteer = require("puppeteer");
const cheerio = require("cheerio");

// Configuration
const SCRAPING_CONFIG = {
  timeout: 30000,
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
  viewport: { width: 1920, height: 1080 },
};

// Utility function for safe scraping
const safeScrape = async (scrapeFunction, source, maxRetries = 2) => {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    let browser;
    try {
      browser = await puppeteer.launch({
        headless: "new",
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
      });

      const result = await scrapeFunction(browser);
      return result;
    } catch (error) {
      console.error(`Attempt ${attempt} failed for ${source}:`, error.message);

      if (attempt === maxRetries) {
        throw new Error(
          `Failed to scrape ${source} after ${maxRetries} attempts: ${error.message}`
        );
      }

      // Wait before retry (exponential backoff)
      await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
    } finally {
      if (browser) {
        await browser
          .close()
          .catch((error) =>
            console.error("Error closing browser:", error.message)
          );
      }
    }
  }
};

// Validate and sanitize inputs
const validateScrapingParams = (search, highprice, category = "") => {
  if (!search || typeof search !== "string") {
    throw new Error("Search query is required and must be a string");
  }

  if (search.length > 100) {
    throw new Error("Search query too long");
  }

  if (highprice && (isNaN(highprice) || highprice < 0)) {
    throw new Error("High price must be a positive number");
  }

  // Sanitize inputs
  const sanitizedSearch = search.trim().substring(0, 100);
  const sanitizedHighPrice = highprice ? Math.abs(parseFloat(highprice)) : "";
  const sanitizedCategory = category ? category.trim() : "";

  return { sanitizedSearch, sanitizedHighPrice, sanitizedCategory };
};

// ---------------- Myntra Scraper ----------------
const scrapeMyntra = async (search, highprice) => {
  const { sanitizedSearch, sanitizedHighPrice } = validateScrapingParams(
    search,
    highprice
  );

  const scrapeFunction = async (browser) => {
    console.log(
      `🔍 Scraping Myntra for: ${sanitizedSearch} up to ${sanitizedHighPrice}`
    );

    const searchQuery = sanitizedSearch.replace(/ /g, "-").toLowerCase();
    const url = `https://www.myntra.com/${searchQuery}?rawQuery=${searchQuery}&price=0-${sanitizedHighPrice}`;

    const page = await browser.newPage();

    try {
      await page.setUserAgent(SCRAPING_CONFIG.userAgent);
      await page.setViewport(SCRAPING_CONFIG.viewport);

      await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: SCRAPING_CONFIG.timeout,
      });

      await page.waitForSelector("li.product-base", { timeout: 15000 });

      const html = await page.content();
      const $ = cheerio.load(html);
      const products = [];

      $("li.product-base").each((i, el) => {
        try {
          const brand = $(el).find(".product-brand").text().trim();
          const productName = $(el).find(".product-product").text().trim();
          const title = `${brand} ${productName}`.trim();

          let image =
            $(el).find("img.img-responsive").attr("src") ||
            $(el).find("source").attr("srcset")?.split("?")[0];

          let price = $(el).find(".product-discountedPrice").text().trim();
          price = price.replace(/[^\d]/g, "");

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

          if (title && price) {
            products.push({
              image:
                image ||
                "https://images.unsplash.com/photo-1513475382585-d06e58bcb0e0?w=300&h=300&fit=crop",
              title,
              price,
              rating,
              offprice: originalPrice || price,
              discount: discount || "0% off",
              href: href
                ? `https://linkredirect.in/visitretailer/2468?id=4620459&shareid=rol1uA1&dl=https://www.myntra.com/${href}`
                : "#",
              source: "myntra",
            });
          }
        } catch (err) {
          console.error("Error processing Myntra product:", err);
        }
      });

      console.log(`✅ Myntra found ${products.length} products`);
      return products;
    } finally {
      await page
        .close()
        .catch((error) => console.error("Error closing page:", error.message));
    }
  };

  return await safeScrape(scrapeFunction, "Myntra");
};

// ---------------- Amazon Scraper ----------------
const scrapeAmazon = async (search, category, highprice) => {
  const { sanitizedSearch, sanitizedHighPrice, sanitizedCategory } =
    validateScrapingParams(search, highprice, category);

  const scrapeFunction = async (browser) => {
    const search_query2 = sanitizedSearch.replace(/ /g, "+");
    const Amazon_PAGE_URL = `https://www.amazon.in/s?k=${search_query2}&i=${sanitizedCategory}&low-price=&high-price=${sanitizedHighPrice}`;

    const page = await browser.newPage();

    try {
      await page.setUserAgent(SCRAPING_CONFIG.userAgent);
      await page.setViewport(SCRAPING_CONFIG.viewport);

      // Block images and unnecessary resources
      await page.setRequestInterception(true);
      page.on("request", (req) => {
        if (["image", "stylesheet", "font"].includes(req.resourceType())) {
          req.abort();
        } else {
          req.continue();
        }
      });

      await page.goto(Amazon_PAGE_URL, {
        waitUntil: "domcontentloaded",
        timeout: SCRAPING_CONFIG.timeout,
      });

      await page
        .waitForSelector(
          ".s-widget-container, [data-component-type='s-search-result']",
          { timeout: 10000 }
        )
        .catch(() =>
          console.log("Amazon products container not found, continuing...")
        );

      const html = await page.content();
      const $ = cheerio.load(html);
      const results = [];

      $(".s-widget-container, [data-component-type='s-search-result']").each(
        (i, element) => {
          try {
            const image = $(element)
              .find(".s-image, .s-product-image-container img")
              .attr("src");
            const title = $(element)
              .find(".s-title-instructions-style, .a-size-medium")
              .text()
              .trim();
            const asin = $(element)
              .find("a.a-link-normal, .s-product-image-container a")
              .attr("href");
            const price = $(element)
              .find(".a-price > span, .a-price-whole")
              .first()
              .text()
              .trim();
            const offprice = $(element)
              .find("div.a-section.aok-inline-block > span")
              .children(".a-offscreen")
              .text();
            const limit_time = $(element)
              .find(".a-badge-label, .s-deal-badge")
              .text()
              .trim();

            let href = "";
            if (asin) {
              const cleanAsin = asin.split("?")[0];
              href = `https://www.amazon.in${cleanAsin}&tag=happyfestiveg-21`;
            }

            if (title && price) {
              const cleanPrice = price.replace(/[^0-9.]/g, "") || "0";

              if (parseFloat(cleanPrice) > 0) {
                results.push({
                  image: image || "",
                  title,
                  price: cleanPrice,
                  offprice: offprice.replace(/[^0-9.]/g, "") || price,
                  limit_time: limit_time || "",
                  href: href || "",
                  source: "amazon",
                });
              }
            }
          } catch (err) {
            console.error("Error processing Amazon product:", err.message);
          }
        }
      );

      // ✅ Remove duplicates by title
      const uniqueResults = Array.from(
        new Map(results.map((item) => [item.title, item])).values()
      );

      console.log(`✅ Amazon found ${uniqueResults.length} unique products`);
      return uniqueResults;
    } finally {
      await page
        .close()
        .catch((error) => console.error("Error closing page:", error.message));
    }
  };

  return await safeScrape(scrapeFunction, "Amazon");
};

// ---------------- Controller ----------------
exports.scrape = async (req, res) => {
  const {
    search = "",
    category = "",
    highprice = "",
  } = req.body || req.query || {};

  try {
    if (!search) {
      return res.status(400).json({ error: "Search query is required" });
    }

    console.log(`Starting scrape for: "${search}"`);

    const [amazonProducts, myntraProducts] = await Promise.allSettled([
      scrapeAmazon(search, category, highprice),
      scrapeMyntra(search, highprice),
    ]);

    let merged = [];

    if (amazonProducts.status === "fulfilled") {
      merged = [...amazonProducts.value];
      console.log(`Amazon: Found ${amazonProducts.value.length} products`);
    } else {
      console.error("Amazon scraping failed:", amazonProducts.reason);
    }

    if (myntraProducts.status === "fulfilled") {
      merged = [...merged, ...myntraProducts.value];
      console.log(`Myntra: Found ${myntraProducts.value.length} products`);
    } else {
      console.error("Myntra scraping failed:", myntraProducts.reason);
    }

    // Sort by price ascending
    merged = merged.sort(
      (a, b) => parseFloat(a.price || 0) - parseFloat(b.price || 0)
    );

    res.json({
      success: true,
      products: merged,
      metadata: {
        total: merged.length,
        sources: {
          amazon: amazonProducts.status === "fulfilled",
          myntra: myntraProducts.status === "fulfilled",
        },
      },
    });
  } catch (error) {
    console.error("Scrape controller error:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Error scraping products",
      data: [],
    });
  }
};
