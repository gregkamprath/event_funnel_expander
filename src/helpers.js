export async function humanDelay(min = 100, max = 400) {
    const delay = Math.floor(Math.random() * (max - min + 1)) + min;
    return new Promise(res => setTimeout(res, delay));
}

export async function autoScroll(page, scrollStep = 250, scrollDelay = 200, maxScrolls = 10) {
  for (let i = 0; i < maxScrolls; i++) {
    await page.evaluate(step => {
      window.scrollBy(0, step);
    }, scrollStep);
    await page.waitForTimeout(scrollDelay);
  }
}