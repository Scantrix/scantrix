import time
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC


class TestLogin:
    def setup_method(self):
        self.driver = webdriver.Chrome()
        self.driver.implicitly_wait(10)  # SE-FLAKE-002: implicit wait

    def teardown_method(self):
        self.driver.quit()

    def test_login_valid(self):
        self.driver.get("http://localhost:3000/login")

        # SE-FLAKE-001: hard sleep
        time.sleep(3)

        email_input = self.driver.find_element(By.xpath("//input[@name='email']"))  # SE-LOC-001: xpath
        email_input.send_keys("admin@example.com")

        password_input = self.driver.find_element(By.XPATH, "//input[@name='password']")  # SE-LOC-001: xpath
        password_input.send_keys("secret123")

        submit_btn = self.driver.find_element(By.css_selector, ".submit-btn")
        submit_btn.click()

        time.sleep(5)  # SE-FLAKE-001: another hard sleep

        assert "/dashboard" in self.driver.current_url

    def test_login_invalid(self):
        self.driver.get("http://localhost:3000/login")
        time.sleep(2)

        email_input = self.driver.find_element(By.xpath("//input[@name='email']"))
        email_input.send_keys("bad@example.com")

        password_input = self.driver.find_element(By.xpath("//input[@name='password']"))
        password_input.send_keys("wrong")

        submit_btn = self.driver.find_element(By.CSS_SELECTOR, ".submit-btn")
        submit_btn.click()

        error = self.driver.find_element(By.xpath("//div[@class='error-msg']"))
        assert "Invalid" in error.text
