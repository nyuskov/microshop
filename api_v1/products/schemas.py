from pydantic import BaseModel, ConfigDict


class ProductBase(BaseModel):
    description: str
    name: str
    price: int


class Product(ProductBase):
    model_config = ConfigDict(from_attributes=True)
    id: int


class ProductCreate(ProductBase):
    pass


class ProductUpdate(ProductCreate):
    pass


class ProductUpdatePartial(ProductCreate):
    description: str | None = None
    name: str | None = None
    price: int | None = None
