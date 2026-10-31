import { useAuth } from "@/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

const VerifyEmail = () => {
  const [verificationStatus, setVerificationStatus] = useState("verifying");
  const { verifyEmail } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const verify = async () => {
      const searchParams = new URLSearchParams(location.search);
      const token = searchParams.get("token");

      if (!token) {
        setVerificationStatus("error");
        return;
      }

      try {
        await verifyEmail(token);
        setVerificationStatus("success");
      } catch (error) {
        console.error("Email verification error:", error);
        setVerificationStatus("error");
      }
    };

    // Only verify if the status is still 'verifying'
    if (verificationStatus === "verifying") {
      verify();
    }
  }, [location.search, verifyEmail, verificationStatus]);

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
              There was an error verifying your email. The link may be invalid
              or expired.
            </p>
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

