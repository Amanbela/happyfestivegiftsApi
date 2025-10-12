// --- Scraping related handlers (uses puppeteer + cheerio) ---
const puppeteer = require("puppeteer");
const cheerio = require("cheerio");

// flipkart scrape
const scrapeFlipkart = async (search, highprice) => {
  const searchQuery = search.replace(/ /g, "%20");
  const Flipkart_PAGE_URL = `https://www.flipkart.com/search?q=${searchQuery}+&p%5B%5D=facets.price_range.from%3DMin&p%5B%5D=facets.price_range.to%3D${highprice}`;
  const browser = await puppeteer.launch({ headless: "new" });
  const page = await browser.newPage();
  await page.goto(Flipkart_PAGE_URL);
  const html = await page.content();
  await browser.close();

  const $ = cheerio.load(html);
  const results = [];
  $("div.DOjaWF.YJG4Cf div:nth-child(1)").each((i, element) => {
    const image = $(element).find(".DByuf4").attr("src");
    const title = $(element).find(".KzDlHZ").text();
    const price = $(element).find(".Nx9bqj._4b5DiR").text();
    const offprice = $(element).find(".yRaY8j.ZYYwLA").text();
    const rating = $(element).find(".XQDdHH").text();
    const href = $(element).find(".CGtC98").attr("href");

    if (title && price) {
      const exists = results.find(
        (p) => p.title === title && p.price === price
      );
      if (!exists) {
        results.push({
          image,
          title,
          price: price.replace(/[^0-9.]/g, ""),
          rating,
          offprice,
          href: href ? `https://www.flipkart.com${href}&affid=kritesh` : null,
          source: "flipkart",
        });
      }
    }
  });
  return results;
};

// amazon scrape
const scrapeAmazon = async (search, category, highprice) => {
  const search_query2 = search.replace(/ /g, "+");
  const Amazon_PAGE_URL = `https://www.amazon.in/s?k=${search_query2}&i=${category}&low-price=&high-price=${highprice}`;
  const browser = await puppeteer.launch({ headless: "new" });
  const page = await browser.newPage();
  await page.goto(Amazon_PAGE_URL);
  const html = await page.content();
  await browser.close();

  const $ = cheerio.load(html);
  const results = [];
  $(".s-widget-container").each((i, element) => {
    const image = $(element).find(".s-image").attr("src");
    const titleElement = $(element).find(".s-title-instructions-style");
    const asin = $(element).find("a.a-link-normal").attr("href");
    const price = $(element).find(".a-price > span").first().text();
    const offprice = $(element)
      .find("div.a-section.aok-inline-block > span")
      .children(".a-offscreen")
      .text();
    const limit_time = $(element).find(".a-badge-label").text();
    const title = titleElement.text();
    let href = "";
    if (asin) href = "https://www.amazon.in" + asin + "&tag=happyfestiveg-21";
    if (title && price) {
      results.push({
        image,
        title,
        price: price.replace(/[^0-9.]/g, ""),
        offprice,
        limit_time,
        href,
        source: "amazon",
      });
    }
  });
  return results;
};

// controller action to expose scraping via POST /products/scrape
exports.scrape = async (req, res) => {
  const { search = "", category = "", highprice = "" } = req.body || {};
  try {
    const [amazonProducts, flipkartProducts] = await Promise.all([
      scrapeAmazon(search, category, highprice),
      scrapeFlipkart(search, highprice),
    ]);
    let merged = [...amazonProducts, ...flipkartProducts];
    merged = merged.sort(
      (p1, p2) => parseFloat(p1.price || 0) - parseFloat(p2.price || 0)
    );
    res.json(merged);
  } catch (err) {
    console.error("Scrape error", err);
    res.status(500).json({ error: "Error scraping products" });
  }
};
