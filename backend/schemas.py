from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict

class LoginReq(BaseModel):
    code: str | None = None
    bindAccessToken: str | None = None
    device: dict[str, Any] | None = None
    userInfo: dict[str, Any] | None = None


class RefreshReq(BaseModel):
    refreshToken: str


class ProfilePatchReq(BaseModel):
    nickname: str | None = None
    avatarUrl: str | None = None


class ConsumeReq(BaseModel):
    amount: int = 1
    bizId: str | None = None
    idempotencyKey: str | None = None


class RewardAdReq(BaseModel):
    adUnitId: str | None = None
    adEventId: str | None = None
    completed: bool = False


class UploadReq(BaseModel):
    dataUrl: str
    width: int = 128
    height: int = 128
    sizeBytes: int | None = None


class ValidateReq(BaseModel):
    imageId: str


class GenerationCreateReq(BaseModel):
    inputImageId: str
    styles: list[str] | None = None
    size: str | None = None


class OrderCreateReq(BaseModel):
    packageId: str


class PaymentNotifyReq(BaseModel):
    orderId: str | None = None
    transactionId: str | None = None
    paid: bool = True


class PosterReq(BaseModel):
    imageUrl: str | None = None
    templateId: str | None = None
    taskId: str | None = None


class FeedbackReq(BaseModel):
    model_config = ConfigDict(extra="allow")
    content: str
    contact: str | None = None
    source: str | None = None


class AdminLoginReq(BaseModel):
    username: str
    password: str


class AdminCreditAdjustReq(BaseModel):
    amount: int | None = None
    balance: int | None = None
    reason: str | None = None
