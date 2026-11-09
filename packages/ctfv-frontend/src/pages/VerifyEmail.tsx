import { useAuth } from "@/auth-context";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

const VerifyEmail = () => {
  const [verificationStatus, setVerificationStatus] = useState("verifying");
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const { verifyEmail } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const verification = useRef<{ token: string; promise: Promise<void> } | null>(null);

  useEffect(() => {
    const token = new URLSearchParams(location.search).get("token");
    if (!token) {
      setError("This verification link is missing its token. Request a new verification email.");
      setVerificationStatus("error");
      return;
    }
    let active = true;
    if (verification.current?.token !== token) {
      setVerificationStatus("verifying");
      setError("");
      verification.current = { token, promise: verifyEmail(token) };
    }
    void verification.current.promise.then(
      () => { if (active) setVerificationStatus("success"); },
      (error) => { if (active) { setError(error instanceof Error ? error.message : "Verification failed. Please try again."); setVerificationStatus("error"); } },
    );
    return () => { active = false; };
  }, [location.search, verifyEmail, attempt]);

  const handleContinue = () => {
    navigate("/");
  };

  return (
    <Card className="mx-auto mt-8 w-full max-w-md">
      <CardHeader>
        <CardTitle className="text-center text-2xl font-bold">
          Email Verification
        </CardTitle>
      </CardHeader>
      <CardContent>
        {verificationStatus === "verifying" && (
          <p className="text-center">Verifying your email...</p>
        )}
        {verificationStatus === "success" && (
          <>
            <p className="mb-4 text-center text-green-600">
              Your email has been successfully verified!
            </p>
            <Button onClick={handleContinue} className="w-full">
              Continue to Dashboard
            </Button>
          </>
        )}
        {verificationStatus === "error" && (
          <>
            <p className="mb-4 text-center text-red-600">
              {error}
            </p>
            {new URLSearchParams(location.search).get("token") && <Button onClick={() => { verification.current = null; setVerificationStatus("verifying"); setAttempt((value) => value + 1); }} className="mb-3 w-full">Retry verification</Button>}
            <Button onClick={() => navigate("/login")} className="w-full">
              Back to Login
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
};

export default VerifyEmail;

