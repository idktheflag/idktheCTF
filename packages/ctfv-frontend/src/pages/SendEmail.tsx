import { apiFetch } from "@/lib/api";
import { useAuth } from "@/auth-context";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getBackendURL } from "@/lib/utils";
import { useCallback, useEffect, useRef, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";

const SendEmail = () => {
  const [resendStatus, setResendStatus] = useState<
    "idle" | "sending" | "sent" | "error"
  >("idle");
  const [error, setError] = useState<string>("");
  const { user } = useAuth();
  const navigate = useNavigate();
  const initialEmailSentRef = useRef(false);

  const handleResendEmail = useCallback(async () => {
    setResendStatus("sending");
    try {
      const response = await apiFetch(
        getBackendURL() + "/api/users/auth/send-verify-email",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${localStorage.getItem("token")}`,
          },
        },
      );

      if (response.ok) {
        setResendStatus("sent");
      } else {
        const data = await response.json();
        throw new Error(data.error || "Failed to resend verification email");
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      setResendStatus("error");
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    if (user?.emailVerified) {
      navigate(user.isAdmin ? "/admin/dashboard" : "/", { replace: true });
    } else if (!initialEmailSentRef.current && user?.email) {
      handleResendEmail();
      initialEmailSentRef.current = true;
    }
  }, [user?.email, user?.emailVerified, user?.isAdmin, navigate, handleResendEmail]);

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return (
    <Card className="mx-auto mt-8 w-full max-w-md">
      <CardHeader>
        <CardTitle className="text-center text-2xl font-bold">
          Verify Your Email
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-4 text-center">
          {resendStatus === "sent" ? "A verification email was accepted for delivery to " : resendStatus === "sending" ? "Sending a verification email to " : "Request a verification email for "}<strong>{user.email}</strong>.
          {resendStatus === "sent" && " Check your inbox and spam folder, then follow the link to complete registration."}
        </p>
        {resendStatus === "sent" && (
          <Alert className="mb-4">
            <AlertDescription>
              Verification email has been resent. Please check your inbox.
            </AlertDescription>
          </Alert>
        )}
        {resendStatus === "error" && (
          <Alert className="mb-4" variant="destructive">
            <AlertDescription>
              Failed to resend verification email. Please try again later.
              Error: {error}
            </AlertDescription>
          </Alert>
        )}
        <Button
          onClick={handleResendEmail}
          disabled={resendStatus === "sending"}
          className="w-full"
        >
          {resendStatus === "sending"
            ? "Sending..."
            : "Resend Verification Email"}
        </Button>
      </CardContent>
    </Card>
  );
};

export default SendEmail;

