"""Customer entity module."""

from typing import List, Dict, Optional
from pydantic import BaseModel, Field, ConfigDict


class Customer(BaseModel):
    """
    Represents a customer.
    """

    companyName: str
    code: str
    firstname: str
    lastname: str
    email: str
    uuid: str

    def to_json(self) -> str:
        """
        Converts the Customer object to a JSON string.

        Returns:
            A JSON string representing the Customer object.
        """
        return self.model_dump_json(indent=4)

    @staticmethod
    def get_customer() -> Optional["Customer"]:
        """
        Retrieves a customer based on their ID.

        Args:
            customer_id: The ID of the customer to retrieve.

        Returns:
            The Customer object if found, None otherwise.
        """
        # In a real application, this would involve a database lookup.
        # For this example, we'll just return a dummy customer.
        return Customer(
            companyName="business test",
            code="asevjfseamfmfmfmfmfm",
            firstname="Alex",
            lastname="Johnson",
            email="alex.johnson@example.com",
            uuid="428765091",
        )