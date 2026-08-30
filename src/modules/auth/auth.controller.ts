import {
  registerCustomerSchema,
  registerVendorSchema,
  loginSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  changePasswordSchema,
  verifyEmailSchema,
  updateProfileSchema,
  avatarSchema,
} from "./auth.validators";

function requestMeta(req: Request) {
  return {
    userAgent: req.headers["user-agent"],
    ipAddress: req.ip,
  };
}

export const registerCustomer = asyncHandler(async (req: Request, res: Response) => {
  const input = registerCustomerSchema.parse(req.body);
  const { user, accessToken, refreshToken } = await authService.registerCustomer(
    input,
    requestMeta(req)
  );
  setAuthCookies(res, accessToken, refreshToken);
  res.status(201).json({ user });
});

export const registerVendor = asyncHandler(async (req: Request, res: Response) => {
  const input = registerVendorSchema.parse(req.body);
  const { user, accessToken, refreshToken } = await authService.registerVendor(
    input,
    requestMeta(req)
  );
  setAuthCookies(res, accessToken, refreshToken);
  res.status(201).json({
    user,
    message: "Account created. Your vendor application is pending review.",
  });
});

export const login = asyncHandler(async (req: Request, res: Response) => {
  const input = loginSchema.parse(req.body);
  const { user, accessToken, refreshToken } = await authService.login(input, requestMeta(req));
  setAuthCookies(res, accessToken, refreshToken);
  res.status(200).json({ user });
});

export const refresh = asyncHandler(async (req: Request, res: Response) => {
  const token = req.cookies?.[REFRESH_COOKIE];
  if (!token) throw AppError.unauthorized("No session to refresh", "NO_REFRESH_TOKEN");

  const { user, accessToken, refreshToken } = await authService.refreshSession(
    token,
    requestMeta(req)
  );
  setAuthCookies(res, accessToken, refreshToken);
  res.status(200).json({ user });
});

export const logout = asyncHandler(async (req: Request, res: Response) => {
  await authService.logout(req.cookies?.[REFRESH_COOKIE]);
  clearAuthCookies(res);
  res.status(200).json({ message: "Logged out" });
});

export const verifyEmail = asyncHandler(async (req: Request, res: Response) => {
  const { token } = verifyEmailSchema.parse(req.body);
  await authService.verifyEmail(token);
  res.status(200).json({ message: "Email verified" });
});

export const forgotPassword = asyncHandler(async (req: Request, res: Response) => {
  const { email } = forgotPasswordSchema.parse(req.body);
  await authService.forgotPassword(email);
  // Deliberately generic — never confirms whether the email exists.
  res.status(200).json({ message: "If that email exists, a reset link has been sent." });
});

export const resetPassword = asyncHandler(async (req: Request, res: Response) => {
  const { token, password } = resetPasswordSchema.parse(req.body);
  await authService.resetPassword(token, password);
  res.status(200).json({ message: "Password reset. Please log in again." });
});

export const changePassword = asyncHandler(async (req: Request, res: Response) => {
  const { currentPassword, newPassword } = changePasswordSchema.parse(req.body);
  await authService.changePassword(req.user!.sub, currentPassword, newPassword);
  clearAuthCookies(res);
  res.status(200).json({ message: "Password changed. Please log in again." });
});

export const deleteAccount = asyncHandler(async (req: Request, res: Response) => {
  await authService.deleteAccount(req.user!.sub);
  clearAuthCookies(res);
  res.status(200).json({ message: "Account deleted" });
});

export const me = asyncHandler(async (req: Request, res: Response) => {
  const user = await authService.getCurrentUser(req.user!.sub);
  res.status(200).json({ user });
});

export const updateProfile = asyncHandler(async (req: Request, res: Response) => {
  const input = updateProfileSchema.parse(req.body);
  const user = await authService.updateProfile(req.user!.sub, input);
  res.status(200).json({ user });
});

export const updateAvatar = asyncHandler(async (req: Request, res: Response) => {
  const { avatarUrl } = avatarSchema.parse(req.body);
  const user = await authService.setAvatar(req.user!.sub, avatarUrl);
  res.status(200).json({ user });
});
