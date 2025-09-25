from pydantic import BaseModel, ConfigDict


class ProductBase(BaseModel):
    description: str
    name: str
    price: int


class Product(ProductBase):
    model_config = ConfigDict(from_attributes=True)
    id: int


class ProductCreate(Product):
    pass
