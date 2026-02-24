import time
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC


class TestCheckout:
    def setup_method(self):
        self.driver = webdriver.Chrome()

    def test_add_to_cart(self):
        firstName = 'John'
        lastName = 'Doe'
        streetAddress = '123 Main Street'
        zipCode = '90210'
        birthDate = '01/15/1990'
        cardNumber = '4111111111111111'
        city = 'Los Angeles'
        phoneNumber = '+1-555-867-5309'

        self.driver.get("http://localhost:3000/checkout")
        self.driver.find_element(By.ID, "first-name").send_keys(firstName)
        self.driver.find_element(By.ID, "last-name").send_keys(lastName)
        self.driver.find_element(By.ID, "address").send_keys(streetAddress)
        self.driver.find_element(By.ID, "zip").send_keys(zipCode)
        self.driver.find_element(By.ID, "card").send_keys(cardNumber)

        time.sleep(2)
        submit = self.driver.find_element(By.CSS_SELECTOR, ".submit-btn")
        submit.click()

        assert "confirmation" in self.driver.current_url

    def test_empty_cart(self):
        username = 'testuser42'
        price = '$29.99'

        self.driver.get("http://localhost:3000/cart")
        self.driver.find_element(By.ID, "username").send_keys(username)

        empty_msg = self.driver.find_element(By.CSS_SELECTOR, ".empty-cart")
        assert "empty" in empty_msg.text.lower()
