from pydantic import BaseModel


class GroupBase(BaseModel):
    name: str
    description: str | None = None


class GroupCreate(GroupBase):
    pass


class GroupUpdate(GroupBase):
    pass


class GroupUpdatePartial(GroupBase):
    name: str | None = None
    description: str | None = None


class Group(GroupBase):
    id: int

    class Config:
        from_attributes = True